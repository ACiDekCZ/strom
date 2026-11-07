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
        // Its help mark stands right before × and opens How Strom works at reading from the app (R8.8).
        const mark = dialog(page).locator('.modal-header > .help-mark');
        await expect(mark).toHaveAttribute('title', 'How it works: Reading a document (R8.8)');
        expect(await dialog(page).locator('.modal-header').evaluate(h => [...h.children].slice(-2).map(c => c.className))).toEqual(['help-mark', 'close-btn']);
        const m = (await mark.boundingBox())!;
        const x = (await dialog(page).locator('.modal-header > .close-btn').boundingBox())!;
        expect(Math.round(x.x - (m.x + m.width))).toBe(8);
        expect(Math.abs((m.y + m.height / 2) - (x.y + x.height / 2))).toBeLessThanOrEqual(1);
        await mark.click();
        await expect(page.locator('.help-rule[data-rule="R8.8"]')).toHaveClass(/is-target/);
        await page.keyboard.press('Escape');
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        await expect(dialog(page)).toBeVisible();
        await expect(mark).toBeFocused();
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
        await expect(d.locator('.read-run')).toHaveAttribute('data-state', 'reading');
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

    test('not ready because the agent has its app here but not its terminal program: its own reason, not "can’t start"', async ({ page }) => {
        await setup(page, { read: readAccepts({ ready: false, why: 'agent.cli-missing' }) });
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(item(page)).toContainText('not possible now: the research agent’s terminal program is not installed here');
        await expect(item(page)).not.toContainText('reading can’t start right now');
        // Its words in the other languages: research-read.test.ts.
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

    test('progress to the result in the dialog: waiting without a running time, reading with it; a reader of no told pace has no several-minutes line', async ({ page }) => {
        const b = await setup(page);
        const d = await openFromMenu(page);
        // Not a slow reader (readSlow: under two minutes, or not said): no several-minutes line.
        await expect(d.locator('.read-drop')).toBeVisible();
        await expect(d.locator('.read-slow-note')).toHaveCount(0);
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await poll(page);
        // Waiting for its turn: said so, no running time.
        await expect(d.locator('.read-run-title')).toHaveText('Waiting');
        await expect(d.locator('.read-run-text')).toHaveText('Another document is being read in the research right now. This reading starts by itself when its turn comes.');
        await expect(d.locator('#read-progress-time')).toBeHidden();
        await expect(d.locator('#read-progress-note')).toHaveText('The window can be closed; the result will be announced.');
        await step(page, b, 'reading');
        await expect(d.locator('.read-run-title')).toHaveText('Reading');
        await expect(d.locator('#read-progress-time')).toBeVisible();
        await expect(d.locator('#read-progress-time')).toHaveText(/^\d+ s$|^\d+ min \d+ s$/);
        await expect(d.locator('#read-progress-note')).toContainText('Usually within');
        await expect(d.locator('.read-run-text')).toHaveCount(0);
        // One reader: no rows of readers, no bar.
        await expect(d.locator('.read-run-rows, .read-bar')).toHaveCount(0);
        await step(page, b, 'done', 1);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-transcript').first()).toContainText('Antonii Novák, Lhota');
        // Opened here: the menu offers reading again.
        await page.keyboard.press('Escape');
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toContainText('Read a document…');
    });

    test('a slow reader: the dialog says reading takes several minutes, the progress how long it usually takes', async ({ page }) => {
        const b = await setup(page, { read: readAccepts({ expectSecs: 300 }) });
        const d = await openFromMenu(page);
        await expect(d.locator('.read-slow-note')).toHaveText('Reading with this agent takes several minutes.');
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await expect(d.locator('#read-foot-note')).toContainText('usually within 5 minutes');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await step(page, b, 'reading');
        await expect(d.locator('#read-progress-note')).toHaveText('Usually within 5 minutes. The window can be closed; the result will be announced.');
        // The bridge's own time for the running reading wins.
        b.read!.reads[0].expectSecs = 480;
        await poll(page);
        await expect(d.locator('#read-progress-note')).toContainText('Usually within 8 minutes.');
        await expect(d.locator('#read-progress-note')).not.toHaveClass(/is-late/);
    });

    test('on the clock alone, the state unchanged: the dialog\'s own asking brings the new usual time, then the time brings "longer than usual"', async ({ page }) => {
        await page.clock.install();
        const b = await setup(page);
        const d = await startReading(page, b);
        await step(page, b, 'reading');
        const note = d.locator('#read-progress-note');
        await expect(note).toContainText('Usually within 3 minutes.');
        await expect(note).not.toHaveClass(/is-late/);
        // The bridge says a slow pace; the reading stays in the same state and nobody asks by hand.
        b.read!.reads[0].expectSecs = 240;
        await page.clock.fastForward(5100);   // the dialog's own asking (every 5 s)
        await expect(note).toContainText('Usually within 4 minutes.');
        // Past the usual time, still the same state: the amber sentence by the clock (no reader rows: of the reading).
        await page.clock.fastForward(5 * 60_000);
        await expect(note).toHaveText('Taking longer than usual (usually within 4 minutes). Reading continues; the window can be closed and the result will be announced.');
        await expect(note).toHaveClass(/is-late/);
    });

    test('queued: no running time and no usual time; running: a new expected time said only by /status shows at once', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        const note = d.locator('#read-progress-note');
        // Queued behind other readings, however long the research expects: no time at all.
        b.read!.reads[0].state = 'queued';
        b.read!.reads[0].expectSecs = 300;
        await poll(page);
        await expect(d.locator('.read-run-title')).toHaveText('Waiting');
        await expect(d.locator('#read-progress-time')).toBeHidden();
        await expect(note).toHaveText('The window can be closed; the result will be announced.');
        // Running: a new expected time alone (same state) is said at once.
        b.read!.reads[0].state = 'reading';
        delete b.read!.reads[0].expectSecs;
        await poll(page);
        await expect(note).toContainText('Usually within 3 minutes.');
        b.read!.reads[0].expectSecs = 240;
        await poll(page);
        await expect(note).toContainText('Usually within 4 minutes.');
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

    test('a busy bridge takes the reading late: the dialog waits for it and follows it, never the input again', async ({ page }) => {
        const b = await setup(page);
        await page.evaluate(() => { (globalThis as { __STROM_READ_TIMEOUT_MS?: number }).__STROM_READ_TIMEOUT_MS = 600; });
        b.read!.startDelayMs = 2000;
        const d = await openFromMenu(page);
        await addPages(page, [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
        await d.locator('[data-act="read"]').click();
        await expect(d.locator('.read-error[data-error="late"]')).toBeVisible();
        await poll(page);
        await expect(d.locator('.read-error[data-error="late"]')).toBeVisible();
        await expect(d.locator('[data-act="read"]')).toHaveCount(0);
        await expect.poll(() => b.read!.reads.length).toBe(1);
        await poll(page);
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
        await expect(d.locator('.read-dialog')).toHaveAttribute('data-phase', 'progress');
        await step(page, b, 'done', 1);
        await expect(d.locator('#read-result')).toBeVisible();
        expect(b.read!.posts).toHaveLength(1);
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
            // On a narrow screen the entries are one row that scrolls sideways (overflow-x: auto) on purpose.
            .filter(c => !(c.closest('.read-entries') && getComputedStyle(c.closest('.read-entries')!).overflowX === 'auto'))
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
            await expect(d.locator('.read-run')).toBeVisible();
            await expect(d.locator('#read-progress-note')).toBeVisible();
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
async function showResult(page: Page, res: Record<string, unknown>, person = '', features?: string[]): Promise<{ d: Locator; b: FakeBridge }> {
    const b = await setup(page, { features });
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

    test('a page of the research\'s media: the archive\'s page from an excerpt of the same scan; without one, no archive link', async ({ page }) => {
        const SHA = 'ab'.repeat(32);
        const PAGE_URL = 'https://archive.example/register/41';
        const res = baptismPage({ pages: [{ n: 1, file: 'M0003', sha: SHA, name: 'matrika-lhota-1846.jpg', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }] });
        const { d } = await showResult(page, res);
        const links = d.locator('.read-scan-links');
        await expect(links.locator('.read-scan-archive')).toHaveCount(0);
        // A source of the tree holds an excerpt cut from this scan, with its page in the archive.
        await page.evaluate(({ sha, url }) => {
            const data = window.Strom.DataManager.getData() as unknown as { sources?: Record<string, unknown> };
            data.sources = { ...(data.sources ?? {}), S0099: { id: 'S0099', title: 'Matrika Lhota', excerpts: [{ id: 'x1', dataUrl: '', width: 1, height: 1, sizeBytes: 0, originalSha: sha.toUpperCase(), pageUrl: url }] } };
        }, { sha: SHA, url: PAGE_URL });
        await d.locator('.read-footer [data-act="close"]').last().click();
        await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
        await expect(d.locator('#read-result')).toBeVisible();
        const archive = d.locator('.read-scan-links .read-scan-archive');
        await expect(archive).toHaveText('Open the page in the archive ↗');
        await expect(archive).toHaveAttribute('href', PAGE_URL);
        await expect(archive).toHaveAttribute('target', '_blank');
    });

    test('title, the result in one sentence, the entry of the dialog\'s person, a mark of its own shape per place and "To check"', { tag: '@smoke' }, async ({ page }) => {
        const { d, b } = await showResult(page, baptismPage(), 'P0003');
        await expect(d.locator('#read-title')).toHaveText('Baptism entry, Latin, Kurrent, 1846');
        await expect(d.locator('.read-file')).toHaveText('matrika-lhota-1846.jpg');
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
        await expect(d.locator('.read-pill')).toHaveCount(0);
        // The entry with the person the dialog was about (P0003) is chosen.
        await expect(d.locator('.read-entry-pill[aria-pressed="true"] .read-entry-n')).toHaveText('Entry 2');
        await expect(d.locator('.read-entry-pill[aria-pressed="true"]')).toContainText('Joannes Novák');
        const tr = d.locator('.read-transcript');
        await expect(tr).toContainText('filius legitimus');
        // Uncertain: dotted with "?"; illegible: a label of its own; a disagreement: reader 1's words marked.
        await expect(tr.locator('.read-mk-unc')).toHaveCount(1);
        await expect(tr.locator('.read-mk-unc')).toContainText('Joannes');
        const ill = tr.locator('.read-mk-ill');
        await expect(ill).toHaveCount(1);
        await expect(ill).toHaveAttribute('aria-label', 'illegible spot');
        await expect(ill).toHaveText('illegible');
        expect(await ill.evaluate(el => getComputedStyle(el).display)).toBe('inline-block');
        await expect(tr.locator('.read-mk-dis')).toHaveText(['Novák']);
        await expect(tr).not.toContainText('Nowak');
        await expect(tr).toContainText('|');
        // Line numbers are drawn, not text: the copy and the text stay as read.
        await expect(tr.locator('.read-line').first()).toHaveAttribute('data-n', '1');
        expect(await tr.evaluate(el => el.textContent ?? '')).not.toMatch(/^\s*1/);
        // "To check": the readers' place, the uncertain word and the illegible spot, each with its line.
        const check = d.locator('.read-check');
        await expect(check.locator('.read-section-title')).toHaveText('To check');
        await expect(check.locator('.read-check-group')).toHaveCount(3);
        expect(await check.locator('.read-check-group').evaluateAll(els => els.map(e => e.getAttribute('data-group')))).toEqual(['dis', 'unc', 'ill']);
        const dis = check.locator('[data-group="dis"] .read-check-row');
        await expect(dis).toHaveCount(1);
        await expect(dis.locator('.read-check-ln')).toHaveText('l. 2');
        await expect(dis.locator('.read-check-side')).toHaveText(['Novák', 'Nowak']);
        await expect(dis.locator('.read-check-side.is-shown')).toHaveText('Novák');
        await expect(dis.locator('.read-rd')).toHaveText(['1', '2']);
        await expect(check.locator('[data-group="unc"] .read-check-kind')).toHaveText('reader was unsure');
        await expect(check.locator('[data-group="ill"] .read-check-kind')).toHaveText('could not be read');
        // A row picks its place in the text; a mark opens its bubble with both readings, Escape closes it.
        await dis.click();
        await expect(dis).toHaveClass(/is-focus/);
        await expect(tr.locator('.read-mk-dis')).toHaveClass(/is-focus/);
        await tr.locator('.read-mk-dis').click();
        const pop = d.locator('#read-pop');
        await expect(pop).toBeVisible();
        await expect(pop.locator('.read-pop-row')).toHaveCount(2);
        await expect(pop.locator('.read-pop-row.is-shown .read-pop-val')).toHaveText('Novák');
        await expect(pop.locator('.read-pop-row').nth(1).locator('.read-pop-val')).toHaveText('Nowak');
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(d).toBeVisible();
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
        // The place chosen above: its line's band; the legend in one row (no place without read.variantRegion).
        await expect(d.locator('#read-scan-line')).toBeVisible();
        await expect(d.locator('.read-scan-legend .read-lg')).toHaveText(['selected entry', 'line']);
        // Footer: nothing written without confirmation, kept in the history; Suggest for the tree… as the main action.
        await expect(d.locator('.read-kept .read-foot-line')).toHaveText(['Nothing is written to the tree without confirmation.', 'The result stays in the reading history.']);
        await expect(d.locator('.read-footer .primary')).toHaveText('Suggest for the tree…');
    });

    test('a line on the text marks it on the scan; a click into the frame marks the line in the text', async ({ page }) => {
        const { d } = await showResult(page, baptismPage(), 'P0003');
        const line = d.locator('#read-scan-line');
        await expect(line).toBeHidden();
        await d.locator('.read-line[data-line="1"]').click();
        await expect(d.locator('.read-line[data-line="1"]')).toHaveClass(/is-active/);
        await expect(line).toBeVisible();
        // Without the research's line regions the band is approximate: dashed edges, no fill.
        await expect(line).toHaveClass(/is-approx/);
        expect(await line.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
        expect(await line.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        const frame = d.locator('.read-frame.is-selected');
        const box = (await frame.boundingBox())!;
        // The second of three lines, inside the entry's frame.
        const band = (await line.boundingBox())!;
        expect(band.y).toBeGreaterThanOrEqual(box.y - 1);
        expect(band.y + band.height).toBeLessThanOrEqual(box.y + box.height + 1);
        expect(band.y - box.y).toBeCloseTo(box.height / 3, -1);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * (5 / 6));
        await expect(d.locator('.read-line.is-active')).toHaveAttribute('data-line', '2');
        const third = (await line.boundingBox())!;
        expect(third.y).toBeGreaterThan(band.y + band.height - 2);
    });

    test('an entry of one line (cells): no strip of a line on the scan, the frame lights up; a click into the frame picks no line', async ({ page }) => {
        const { d } = await showResult(page, baptismPage({
            entries: [{
                id: 'e1', page: 1, region: [0.08, 0.3, 0.84, 0.08],
                transcript: '1846 | 12 | Joannes Novák | Antonius Novák | Lhota', variants: [{ at: 'Novák', other: 'Nowak' }],
                persons: [{ ref: 'p1', role: 'child', given: 'Joannes', surname: 'Novák', match: [{ person: 'P0003', why: 'name', score: 0.8 }] }],
            }],
        }), 'P0003');
        const strip = d.locator('#read-scan-line');
        const frame = d.locator('.read-frame.is-selected');
        await expect(frame).not.toHaveClass(/is-lit/);
        const text = d.locator('.read-line[data-line="0"]');
        await text.hover();
        await expect(frame).toHaveClass(/is-lit/);
        await expect(strip).toBeHidden();
        await text.click();
        await expect(text).toHaveClass(/is-active/);
        await expect(strip).toBeHidden();
        await expect(frame).toHaveClass(/is-lit/);
        // A click into the frame keeps the line as it was (one line: the whole entry).
        await text.click();
        await expect(text).not.toHaveClass(/is-active/);
        const box = (await frame.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(d.locator('.read-line.is-active')).toHaveCount(0);
        await expect(strip).toBeHidden();
        // No band drawn for an entry of one line: the legend does not name the line.
        await expect(d.locator('.read-scan-legend .read-lg')).toHaveText(['selected entry']);
    });

    test('several entries: a pill or a frame chooses one; the text and the suggestion follow', async ({ page }) => {
        const { d } = await showResult(page, baptismPage());
        // Without a person: the first entry.
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '0');
        await expect(d.locator('.read-transcript')).toContainText('Georgii Svoboda');
        await expect(d.locator('.read-section--translation')).toHaveCount(0);
        await expect(d.locator('.read-check')).toHaveCount(0);
        await expect(d.locator('#read-verdict')).toHaveText('Read. The readers agree.');
        await d.locator('.read-frame[data-entry="1"]').click();
        await expect(d.locator('.read-frame.is-selected')).toHaveAttribute('data-entry', '1');
        await expect(d.locator('.read-entry-pill[data-entry="1"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(d.locator('.read-transcript')).toContainText('Joannes');
        await expect(d.locator('.read-section--translation')).toBeVisible();
        // The header's sentence follows the entry.
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
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
        // No data, no section: no explanation, nothing to check.
        await expect(d.locator('.read-section--gloss')).toHaveCount(0);
        await expect(d.locator('.read-check')).toHaveCount(0);
        // One reader: nothing said of agreeing.
        await expect(d.locator('#read-verdict')).toHaveText('Read.');
        await expect(d.locator('.read-who-sentence')).toHaveText('Read by one reader.');
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
        await expect(d2.locator('#read-s-transcript')).toHaveText('Text as read');
        await expect(d2.locator('.read-section--translation')).toBeVisible();
        await expect(d2.locator('.read-section--mentioned')).toContainText('Mentioned');
        await expect(d2.locator('.read-mentioned li')).toHaveCount(2);
        await expect(d2.locator('[data-act="propose"]')).toHaveCount(0);
        await expect(d2.locator('.read-footer .primary')).toHaveText('Close');
    });

    test('partly legible: the reason and the advice in the header\'s sentence, Insert a better photo goes back to the input', async ({ page }) => {
        const PARTLY = { kind: 'register.death', language: ['la'], script: '', date: '1850', legible: 'partly', why: 'glare' };
        // A few illegible words only: read, with their count; nothing more said.
        const few = await showResult(page, baptismPage({ doc: PARTLY }), 'P0003');
        await expect(few.d.locator('#read-title')).toHaveText('Death entry, Latin, 1850');
        await expect(few.d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
        await expect(few.d.locator('#read-verdict [data-act="insert-other"]')).toHaveCount(0);
        await few.d.locator('.read-footer [data-act="close"]').last().click();
        // More than three: read only in part, why, what to do and the way to a better photo; no notice over the text.
        const entries = (baptismPage().entries as Record<string, unknown>[]).map((e, k) => k === 1
            ? { ...e, transcript: 'Joannes[?] filius legitimus\nAntonii Novák et Mariae [...] [...]\nLhota N. [...] | patrinus [...]' } : e);
        const { d } = await showResult(page, baptismPage({ doc: PARTLY, entries }), 'P0003');
        const verdict = d.locator('#read-verdict');
        await expect(verdict).toHaveText('Read only in part: 4 words illegible (glare over the text). The readers disagree in 1 place. Take it straight on, without flash, in even light. Insert a better photo');
        await expect(d.locator('.read-kinds-note, .read-partial')).toHaveCount(0);
        await verdict.locator('[data-act="insert-other"]').click();
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
            await expect(d.locator('#read-verdict')).toHaveText('Gelesen, 1 Wort unleserlich. Die Leser weichen an 1 Stelle voneinander ab.');
            await expect(d.locator('[data-act="propose"]')).toHaveText('In den Stammbaum vorschlagen…');
            await expect(d.locator('.read-kept .read-foot-line')).toHaveText(['Ohne Bestätigung wird nichts in den Stammbaum eingetragen.', 'Das Ergebnis bleibt im Leseverlauf.']);
            await expect(d.locator('.read-check-head').first()).toContainText('Leser weichen ab');
            await noOverflow(d.locator('.read-check'));
            await expect(d.locator('.read-scan-img')).toBeVisible();
            await noOverflow(d.locator('.modal'));
            await noOverflow(d.locator('.read-text'));
            await noOverflow(d.locator('.read-footer'));
            const scan = (await d.locator('#read-scan').boundingBox())!;
            const text = (await d.locator('#read-text').boundingBox())!;
            if (viewport.width > 1024) {
                expect(Math.round(scan.width)).toBe(500);
                expect(text.x).toBeGreaterThan(scan.x + scan.width - 2);
            } else if (viewport.width > 640) {
                // A tablet: the desktop's layout with a scan of 300 px.
                expect(Math.round(scan.width)).toBe(300);
                expect(text.x).toBeGreaterThan(scan.x + scan.width - 2);
            } else {
                // The scan as a strip on top with the chosen entry's crop; the text below it.
                await expect(d.locator('.read-scan-view')).toHaveClass(/is-strip/);
                expect(text.y).toBeGreaterThanOrEqual(scan.y + scan.height - 2);
                const box = (await d.locator('.read-scan-box').boundingBox())!;
                expect(Math.round(box.height)).toBe(116);
                const frame = (await d.locator('.read-frame.is-selected').boundingBox())!;
                expect(frame.width).toBeGreaterThan(box.width * 0.8);
                const foot = (await d.locator('[data-act="propose"]').boundingBox())!;
                expect(foot.height).toBeGreaterThanOrEqual(48);
                // Scan shows the whole scan in its tab.
                await d.locator('[data-act="scan-tab"]').click();
                await expect(d.locator('#read-result')).toHaveClass(/is-scan-tab/);
                await expect(d.locator('.read-scan-view')).not.toHaveClass(/is-strip/);
                await noOverflow(d.locator('.modal'));
            }
        });
    });
}

/**
 * Two readers with `read.blindText` and `read.kinds` (spec 059 K6.6, K6.10): the second reader's whole text a
 * switch away, its places marked from its side; readers that differ on the kind of entry said above the text and
 * at Propose. Without the features the same result shows as today.
 */
test.describe('Read a document: the second reader\'s text, the kinds', () => {
    test.use({ viewport: DESKTOP });

    const WHO = [
        { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
        { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
    ];
    const BLIND_TEXT = 'Joannes filius legitimus\nAntonii Nowak et Mariae [...]\nLhota N. 12 | patrinus Wenceslaus';
    const blindPage = (over: Record<string, unknown> = {}): Record<string, unknown> => baptismPage({
        readers: { asked: 2, ran: 2, agree: 'differ', who: WHO },
        blind: { doc: { kind: 'register.baptism' }, entries: [
            { id: 'b1', page: 1, region: [0.08, 0.42, 0.84, 0.36], transcript: BLIND_TEXT, of: 'e2' },
            { id: 'b2', page: 1, region: [0.08, 0.8, 0.84, 0.15], transcript: 'Ludmila filia Ignatii Kortan', of: '' },
        ] },
        ...over,
    });

    test('read.blindText: Reader 1 / Reader 2 beside the title; reader 2\'s text with its marks, copied as shown; the programs named once, under the text', async ({ page }) => {
        const { d } = await showResult(page, blindPage(), 'P0003', ['read.now', 'read.blindText']);
        const seg = d.locator('#read-result .read-section--transcript .read-section-head .read-reader-seg');
        await expect(seg).toHaveAttribute('role', 'group');
        const btns = seg.locator('.read-reader-btn');
        await expect(btns).toHaveText(['Reader 1', 'Reader 2']);
        await expect(btns.nth(0)).toHaveAttribute('aria-pressed', 'true');
        await expect(btns.nth(1)).toHaveAttribute('aria-pressed', 'false');
        const tr = d.locator('.read-transcript');
        await expect(tr.locator('.read-mk-dis')).toHaveText(['Novák']);
        await expect(d.locator('.read-who-sentence')).toHaveText('Text by reader 1 (Claude Code · Opus). Reader 2 (Codex · GPT-6-Astra) read independently, as a check.');
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
        const named = await d.evaluate(el => (el.textContent ?? '').split('Claude Code').length - 1);
        expect(named).toBeLessThanOrEqual(1);
        const rows = d.locator('.read-check [data-group="dis"] .read-check-row');
        await expect(rows.locator('.read-check-side.is-shown')).toHaveText('Novák');
        await tr.locator('.read-line[data-line="1"]').click();
        await expect(d.locator('#read-scan-line')).toBeVisible();

        await btns.nth(1).click();
        await expect(btns.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(btns.nth(0)).toHaveAttribute('aria-pressed', 'false');
        await expect(d.locator('.read-section--transcript')).toHaveClass(/is-second/);
        // Its own text with its own marks: its words of the place marked, nothing uncertain, the illegible spot.
        await expect(tr).toContainText('Joannes filius legitimus');
        await expect(tr.locator('.read-mk-unc')).toHaveCount(0);
        await expect(tr.locator('.read-mk-ill')).toHaveCount(1);
        await expect(tr.locator('.read-mk-dis')).toHaveText(['Nowak']);
        // Its lines are not reader 1's lines on the scan: no line to choose there; the band chosen in reader 1's text stays.
        await expect(d.locator('#read-scan-line')).toBeVisible();
        await expect(tr.locator('.read-line[data-line]')).toHaveCount(0);
        // The place stays as it was, ① then ②, the shown reader bold; the groups follow the marks of the text shown.
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.read-check-side')).toHaveText(['Novák', 'Nowak']);
        await expect(rows.locator('.read-check-side.is-shown')).toHaveText('Nowak');
        expect(await d.locator('.read-check-group').evaluateAll(els => els.map(e => e.getAttribute('data-group')))).toEqual(['dis', 'ill']);
        // The translation and explanation are reader 1's.
        await expect(d.locator('.read-from-first')).toHaveText('Translation and explanation are reader 1’s (reader 2 reads blind, without a translation).');
        // What only reader 2 read: folded.
        const extra = d.locator('.read-blind-extra');
        await expect(extra.locator('summary')).toHaveText('Reader 2 also read 1 more entry');
        await expect(extra).not.toHaveAttribute('open', '');
        await extra.locator('summary').click();
        await expect(extra).toContainText('Ludmila filia Ignatii Kortan');
        // Copy: the text shown.
        await page.evaluate(() => {
            (window as any).__copied = null;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { (window as any).__copied = t; } } });
        });
        await d.locator('[data-act="copy"]').click();
        await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe(BLIND_TEXT);

        // Back to reader 1: as before.
        await btns.nth(0).click();
        await expect(d.locator('.read-section--transcript')).not.toHaveClass(/is-second/);
        await expect(tr.locator('.read-mk-dis')).toHaveText(['Novák']);
        await expect(d.locator('.read-from-first, .read-blind-extra')).toHaveCount(0);
        await expect(d.locator('#read-scan-line')).toBeVisible();
        await expect(tr.locator('.read-line[data-line="1"]')).toHaveClass(/is-active/);
    });

    test('an entry reader 2 did not read: its button off, saying so; never that the readers agree; the view kept across entries', async ({ page }) => {
        const { d } = await showResult(page, blindPage(), 'P0003', ['read.now', 'read.blindText']);
        const btns = d.locator('.read-reader-btn');
        await btns.nth(1).click();
        await expect(d.locator('.read-section--transcript')).toHaveClass(/is-second/);
        // The first entry: no counterpart at reader 2, its own text shown, the button off.
        await d.locator('.read-entry-pill[data-entry="0"]').click();
        await expect(btns.nth(1)).toBeDisabled();
        await expect(btns.nth(1)).toHaveText('Reader 2 · did not read');
        await expect(btns.nth(1)).toHaveAttribute('aria-disabled', 'true');
        expect(await btns.nth(1).evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
        await expect(btns.nth(0)).toHaveAttribute('aria-pressed', 'true');
        await expect(d.locator('.read-transcript')).toContainText('Anna filia legitima');
        await expect(d.locator('#read-verdict')).toHaveText('Read.');
        await expect(d.locator('.read-who-sentence')).toHaveText('Only reader 1 read this entry (Claude Code · Opus).');
        await expect(d.locator('#read-text')).not.toContainText(/agree/);
        // Back to the second entry: reader 2's view, as chosen.
        await d.locator('.read-entry-pill[data-entry="1"]').click();
        await expect(btns.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(d.locator('.read-transcript')).toContainText('Antonii Nowak');
    });

    test('reader 2 failed: the reading done with reader 1 alone, "Reader 2 · did not read" off, never that the readers agree', async ({ page }) => {
        const res = oneEntry('register.baptism', ['cs'], { transcript: 'Jan Vlk syn Josefa Vlka\nKateřina Vlková z Doubravy', variants: [],
            persons: [{ ref: 'p1', role: 'child', given: 'Jan', surname: 'Vlk' }] });
        const { d } = await showResult(page, { ...res, readers: { asked: 2, ran: 1, agree: null, who: [WHO[0], { ...WHO[1], ran: false }] } }, '', ['read.now', 'read.blindText']);
        const btns = d.locator('.read-reader-seg .read-reader-btn');
        await expect(btns).toHaveText(['Reader 1', 'Reader 2 · did not read']);
        await expect(btns.nth(1)).toBeDisabled();
        await expect(d.locator('#read-verdict')).toHaveText('Read.');
        await expect(d.locator('.read-who-sentence')).toHaveText('Only reader 1 read this entry (Claude Code · Opus).');
        await expect(d.locator('#read-result')).not.toContainText(/agree/);
        await expect(d.locator('.read-check')).toHaveCount(0);
        // Not even without the second reader's texts announced.
        await d.locator('.read-footer [data-act="close"]').last().click();
    });

    test('without read.blindText: no switch, the same result as today', async ({ page }) => {
        const { d } = await showResult(page, blindPage(), 'P0003');
        await expect(d.locator('.read-reader-seg, .read-from-first, .read-blind-extra')).toHaveCount(0);
        await expect(d.locator('.read-transcript .read-mk-dis')).toHaveText(['Novák']);
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
    });

    const kindsPage = (): Record<string, unknown> => baptismPage({
        readers: { asked: 2, ran: 2, agree: 'differ', who: WHO, kinds: { first: 'register.marriage', blind: 'register.baptism' } },
    });
    const KINDS = '!The readers disagree on the kind of entry: reader 1 reads marriage, reader 2 baptism. This changes how the whole entry is read. To be checked against the scan before writing to the tree.';

    test('read.kinds: the readers differ on the kind of entry, said above the text and at Propose', async ({ page }) => {
        const { d } = await showResult(page, kindsPage(), 'P0003', ['read.now', 'read.kinds']);
        const note = d.locator('#read-result .read-kinds-note');
        await expect(note).toHaveText(KINDS);
        await expect(note).toHaveAttribute('role', 'note');
        expect(await note.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');
        // One notice only, and the readers never said to agree beside it.
        await expect(d.locator('#read-result .read-kinds-note, #read-result .read-nc')).toHaveCount(1);
        await expect(d.locator('#read-verdict')).toHaveText('Read, 1 word illegible. The readers disagree in 1 place.');
        await d.locator('[data-act="propose"]').click();
        const at = d.locator('#read-propose .read-kinds-note');
        await expect(at).toHaveText(KINDS);
        await expect(at).toHaveAttribute('role', 'note');
    });

    test('without read.kinds: nothing said of the kinds, at the result or at Propose', async ({ page }) => {
        const { d } = await showResult(page, kindsPage(), 'P0003');
        await expect(d.locator('.read-transcript')).toBeVisible();
        await expect(d.locator('.read-kinds-note')).toHaveCount(0);
        await d.locator('[data-act="propose"]').click();
        await expect(d.locator('#read-propose')).toBeVisible();
        await expect(d.locator('.read-kinds-note')).toHaveCount(0);
    });
});

/**
 * The scan (spec 059 P7 §7) and the small screens (§10): a line's band, the place's outline (`read.variantRegion`),
 * Enlarge beside the text on a desktop only, the phone's strip, Scan tab and bottom sheet. Invented names.
 */
const VLK_LONG = 'Maximilian Bartholomäus Vlkovský';
const VLK_TEXT = [
    'Anno 1852 die 3. Aprilis baptizatus est', 'Joannes Vlk filius legitimus', 'Josephi Vlk agricolae in Doubrava N. 7',
    'et Catharinae Vlková natae Kortan', 'patrini Wenceslaus Vlk et Anna Vlková', 'obstetrix Maria Kortanová examinata',
    'baptizavit Franciscus Vlk cooperator', 'natus die 2. Aprilis hora 5 matutina', 'religio catholica sexus masculinus',
    'nota bene: in margine scriptum',
].join('\n');
function vlkPage(over: Record<string, unknown> = {}): Record<string, unknown> {
    return baptismPage({
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '1852', legible: 'yes', why: null },
        readers: { asked: 2, ran: 2, agree: 'differ', who: [
            { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
            { agent: 'codex', name: 'Codex', model: 'gpt-6-astra', modelName: 'GPT-6-Astra', effort: 'xhigh', ran: true },
        ] },
        entries: [
            { id: 'e1', page: 1, region: [0.06, 0.04, 0.88, 0.06], transcript: `1852 | 1 | ${VLK_LONG} | Lhota`, variants: [],
                persons: [{ ref: 'p1', role: 'child', given: 'Maximilian Bartholomäus', surname: 'Vlkovský' }] },
            { id: 'e2', page: 1, region: [0.06, 0.12, 0.88, 0.6], transcript: VLK_TEXT,
                variants: [{ at: 'Doubrava', other: 'Dubrava', region: [0.5, 0.24, 0.16, 0.04] }],
                persons: [{ ref: 'p1', role: 'child', given: 'Joannes', surname: 'Vlk', match: [{ person: 'P0003', why: 'name', score: 0.8 }] }] },
            { id: 'e3', page: 1, region: [0.06, 0.76, 0.88, 0.1], transcript: 'Ludmila Vlková filia\nJosephi Vlk', variants: [],
                persons: [{ ref: 'p1', role: 'child', given: 'Ludmila', surname: VLK_LONG }] },
        ],
        blind: { doc: { kind: 'register.baptism' }, entries: [
            { id: 'b2', page: 1, region: [0.06, 0.12, 0.88, 0.6], transcript: VLK_TEXT.replace('Doubrava', 'Dubrava'), of: 'e2' },
        ] },
        ...over,
    });
}
const VLK_FEATURES = ['read.now', 'read.blindText', 'read.variantRegion'];

test.describe('Read a document: the scan', () => {
    test.use({ viewport: DESKTOP });

    test('To check: a row shows its line\'s band and, with read.variantRegion, the place\'s outline; a line under the mouse shows its band', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
        const band = d.locator('#read-scan-line');
        const spot = d.locator('#read-scan-place');
        await expect(d.locator('.read-scan-legend .read-lg')).toHaveText(['selected entry', 'line', 'place']);
        await expect(band).toBeHidden();
        // A line under the mouse: its band, gone again when the mouse leaves.
        await d.locator('.read-line[data-line="4"]').hover();
        await expect(band).toBeVisible();
        await d.locator('#read-verdict').hover();
        await expect(band).toBeHidden();
        await d.locator('.read-check-row[data-place]').first().click();
        await expect(d.locator('.read-line[data-line="2"]')).toHaveClass(/is-active/);
        await expect(band).toBeVisible();
        await expect(spot).toBeVisible();
        const frame = (await d.locator('.read-frame.is-selected').boundingBox())!;
        const b = (await band.boundingBox())!;
        const o = (await spot.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(frame.y - 1);
        expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
        expect(o.x).toBeGreaterThan(frame.x);
        expect(o.x + o.width).toBeLessThan(frame.x + frame.width);
        // The same row style in the text: a fill and a bar on its left.
        expect(await d.locator('.read-line[data-line="2"]').evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
        // Reader 2's text: the band and the outline stay.
        await d.locator('.read-reader-btn[data-reader="2"]').click();
        await expect(band).toBeVisible();
        await expect(spot).toBeVisible();
        // Another entry: nothing chosen there.
        await d.locator('.read-entry-pill[data-entry="2"]').click();
        await expect(band).toBeHidden();
        await expect(spot).toBeHidden();
    });

    test('without read.variantRegion: the band alone, no outline, the legend without the place', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), 'P0003', ['read.now', 'read.blindText']);
        await expect(d.locator('.read-scan-legend .read-lg')).toHaveText(['selected entry', 'line']);
        await d.locator('.read-check-row[data-place]').first().click();
        await expect(d.locator('#read-scan-line')).toBeVisible();
        await expect(d.locator('#read-scan-place')).toBeHidden();
    });

    test('a click on the scan: its entry, then its line in the text; the frames told apart', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
        const frames = d.locator('.read-frame');
        expect(parseFloat(await frames.nth(1).evaluate(el => getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(2);
        expect(await frames.nth(0).evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');
        // The entry's label in words inside the frame's top right corner.
        await expect(frames.nth(1).locator('.read-frame-n')).toHaveText('entry 2');
        const f = (await frames.nth(1).boundingBox())!;
        const tag = (await frames.nth(1).locator('.read-frame-n').boundingBox())!;
        expect(tag.x + tag.width).toBeLessThanOrEqual(f.x + f.width);
        expect(tag.y).toBeGreaterThanOrEqual(f.y);
        // A click in the chosen frame: the line under it chosen in the text.
        await page.mouse.click(f.x + f.width / 2, f.y + f.height * 0.95);
        await expect(d.locator('.read-line.is-active')).toHaveAttribute('data-line', '9');
        await expect(d.locator('#read-scan-line')).toBeVisible();
        // Another frame: its entry.
        const g = (await frames.nth(2).boundingBox())!;
        await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '2');
    });

    test('an entry of one line: no band', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), '', VLK_FEATURES);
        await expect(d.locator('.read-entry-pill.is-selected')).toHaveAttribute('data-entry', '0');
        await d.locator('.read-line[data-line="0"]').click();
        await expect(d.locator('#read-scan-line')).toBeHidden();
        await expect(d.locator('.read-frame.is-selected')).toHaveClass(/is-lit/);
    });

    test('Enlarge beside the text: the scan\'s column 500 → 780 px, the text stays beside it; Reduce returns it', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
        const zoom = d.locator('.read-scan-zoom');
        await expect(zoom).toHaveText('+ Enlarge beside the text');
        expect(Math.round((await d.locator('#read-scan').boundingBox())!.width)).toBe(500);
        await zoom.click();
        await expect(zoom).toHaveText('− Reduce');
        await expect(zoom).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => Math.round((await d.locator('#read-scan').boundingBox())!.width)).toBe(780);
        const scan = (await d.locator('#read-scan').boundingBox())!;
        const text = (await d.locator('#read-text').boundingBox())!;
        expect(text.x).toBeGreaterThan(scan.x + scan.width - 2);
        await expect(d.locator('[data-act="open-page"]')).toHaveCount(0);
        await zoom.click();
        await expect.poll(async () => Math.round((await d.locator('#read-scan').boundingBox())!.width)).toBe(500);
    });
});

for (const viewport of [{ width: 834, height: 1112 }, PHONE]) {
    test.describe(`Read a document: no Enlarge beside the text at ${viewport.width}px`, () => {
        test.use({ viewport });
        test('not offered', async ({ page }) => {
            const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
            await expect(d.locator('.read-scan-zoom')).toBeHidden();
        });
    });
}

test.describe('Read a document: the result on a phone', () => {
    test.use({ viewport: PHONE });

    test('the strip of 116 px over the text, at least 8 lines of the text at once; Scan and back; the bubble a sheet with Show on the scan', async ({ page }) => {
        const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
        const box = (await d.locator('.read-scan-box').boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(116.5);
        await expect(d.locator('.read-strip-tag')).toHaveText('entry 2');
        await expect(d.locator('.read-entries')).toBeHidden();
        await expect(d.locator('.read-scan-legend')).toBeHidden();
        // Lines of the text seen without scrolling.
        const seen = await d.evaluate(() => {
            const host = document.getElementById('read-result')!.getBoundingClientRect();
            return [...document.querySelectorAll('#read-transcript .read-line')].filter(l => {
                const r = l.getBoundingClientRect();
                return r.top >= host.top && r.bottom <= host.bottom;
            }).length;
        });
        expect(seen).toBeGreaterThanOrEqual(8);
        // The footer: the main action across the width, Close as × in the header.
        await expect(d.locator('.read-footer [data-act="close"]')).toBeHidden();
        await expect(d.locator('.modal-header [data-act="close"]')).toBeVisible();
        const propose = (await d.locator('[data-act="propose"]').boundingBox())!;
        expect(propose.height).toBeGreaterThanOrEqual(48);
        // The reader switch without names, 40 px at least.
        expect((await d.locator('.read-reader-btn').first().boundingBox())!.height).toBeGreaterThanOrEqual(40);
        // Scan: the whole scan, its chips, legend and back.
        await d.locator('[data-act="scan-tab"]').click();
        await expect(d.locator('#read-text')).toBeHidden();
        await expect(d.locator('.read-entries')).toBeVisible();
        await expect(d.locator('.read-scan-legend')).toBeVisible();
        expect((await d.locator('.read-entry-pill').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await d.locator('[data-act="scan-tab-off"]').click();
        await expect(d.locator('#read-text')).toBeVisible();
        // A mark: the bubble at the bottom, Show on the scan with the line's band.
        await d.locator('#read-transcript .read-mk-dis').first().click();
        const pop = d.locator('#read-pop');
        await expect(pop).toHaveClass(/is-sheet/);
        const p = (await pop.boundingBox())!;
        expect(Math.round(p.y + p.height)).toBeGreaterThanOrEqual(PHONE.height - 2);
        await pop.locator('[data-act="pop-scan"]').click();
        await expect(d.locator('#read-result')).toHaveClass(/is-scan-tab/);
        await expect(d.locator('#read-scan-line')).toBeVisible();
        await expect(d.locator('#read-scan-place')).toBeVisible();
    });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 640, height: 900 }, { width: 844, height: 390 }, { width: 834, height: 1112 }, DESKTOP]) {
    test.describe(`Read a document: the scan in German at ${viewport.width}×${viewport.height}`, () => {
        test.use({ viewport, locale: 'de-DE' });
        test('long names: nothing runs over in the dialog, the chips, the reader switch, To check', async ({ page }) => {
            const { d } = await showResult(page, vlkPage(), 'P0003', VLK_FEATURES);
            await expect(d.locator('.read-scan-zoom')).toHaveCount(1);
            await noOverflow(d.locator('.modal'));
            await noOverflow(d.locator('.read-reader-seg'));
            await noOverflow(d.locator('.read-check'));
            const chips = d.locator('.read-entries');
            if (viewport.width <= 640) await d.locator('[data-act="scan-tab"]').click();
            if (await chips.isVisible()) {
                await noOverflow(chips);
                // A chip never breaks inside.
                const lines = await chips.locator('.read-entry-pill').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetHeight > 0)
                    .map(e => e.getBoundingClientRect().height));
                for (const h of lines) expect(h).toBeLessThan(50);
            }
            if (viewport.height <= 500) {
                // Held sideways: only the chosen entry's chip, no legend.
                await expect(chips.locator('.read-entry-pill:visible')).toHaveCount(1);
                await expect(d.locator('.read-scan-legend')).toBeHidden();
            }
        });
    });
}
