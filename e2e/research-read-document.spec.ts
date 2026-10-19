import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, openResearchMenu, poll, FakeBridge, READ_ID } from './research-bridge.js';
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

async function openFromMenu(page: Page): Promise<Locator> {
    await openResearchMenu(page);
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
        await openResearchMenu(page);
        await expect(item(page)).toBeVisible();
        await expect(item(page)).toContainText('Read a document…');
        await expect(item(page)).toContainText('starts the research agent');
        await expect(item(page)).not.toHaveAttribute('aria-disabled', 'true');
        await item(page).click();
        await expect(dialog(page).locator('#read-title')).toHaveText('Read a document');
        await expect(dialog(page).locator('#read-drop')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);

        // The person menu: the dialog with the person chosen.
        await cardAction(page, 'Jan', 'research-read');
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('#read-person-picker input')).toHaveValue('Jan Fíšek');
    });

    test('not ready: shown greyed with the reason and the way to the research; not in the person menu', async ({ page }) => {
        await setup(page, { read: readAccepts({ ready: false, why: 'auth' }) });
        await openResearchMenu(page);
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
        await openResearchMenu(page);
        await expect(page.locator('#research-sync-block, .research-menu').first()).toBeVisible();
        await expect(item(page)).toHaveCount(0);
    });

    test('absent for an older research (no read.now)', async ({ page }) => {
        await setup(page, { features: [] });
        await openResearchMenu(page);
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

    test('progress to the result in the dialog', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await expect(d.locator('.read-step.is-now')).toHaveCount(1);
        await expect(d.locator('#read-progress-time')).toContainText('Usually within');
        await step(page, b, 'reading');
        await expect(d.locator('.read-step.is-done')).not.toHaveCount(0);
        await step(page, b, 'done', 1);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-transcript').first()).toContainText('Antonii Novák, Lhota');
        // Opened here: the menu offers reading again.
        await page.keyboard.press('Escape');
        await openResearchMenu(page);
        await expect(item(page)).toContainText('Read a document…');
    });

    test('dialog closed: the menu says it reads, then the notice when it ends; Show opens the result', async ({ page }) => {
        const b = await setup(page);
        const d = await startReading(page, b);
        await d.locator('.read-footer [data-act="close"]').last().click();
        await expect(dialog(page)).toHaveCount(0);
        await openResearchMenu(page);
        await expect(item(page)).toContainText('Reading a document…');
        await page.keyboard.press('Escape');

        await step(page, b, 'done', 1);
        const toast = page.locator('.toast', { hasText: 'Document read' });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('baptism');
        await openResearchMenu(page);
        await expect(item(page)).toContainText('Document read');
        await page.keyboard.press('Escape');
        await toast.locator('.toast-action').click();
        await expect(dialog(page).locator('#read-result')).toBeVisible();
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
            const b = await setup(page);
            await openResearchMenu(page);
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
            await noOverflow(d.locator('.modal'));
        });
    });
}
