import { test, expect, Page, Locator } from '@playwright/test';

/**
 * "Add images" at an item waiting for images of a book (spec 048 §3, §7, §8):
 * files chosen or dropped get their numbers (by name, in order, by hand),
 * go one by one through the bridge (PUT media with the task and the number),
 * what the bridge refuses is said at the file (saved already: Replace; a
 * number not asked for: the numbers it asks for), the task that got its last
 * image leaves the list. The small panel's one action and its dialog, a file
 * dropped on a row, the phone's answer sheet. An older bridge offers none of
 * it. Invented data only.
 */

const UUID = '6b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const BRIDGE = 'http://127.0.0.1:5996/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Hruskovi',
    '0 @P0001@ INDI', '1 NAME Bedřich /Hruška/', '1 SEX M', '1 BIRT', '2 DATE 1858', '1 REFN P0001',
    '0 TRLR',
].join('\n');

interface Reply { status: number; body: Record<string, unknown> }
interface Put { task: string; image: string | null; replace: string | null; name: string | null }
interface Bridge {
    waiting: Record<string, unknown>[];
    features: string[];
    accepts?: Record<string, unknown>;
    /** The answers the next uploads get, in turn (none left: saved by its number, the task wakes with its last one). */
    replies: Reply[];
    puts: Put[];
    answers: { task: string; body: Record<string, unknown> }[];
}

const ARCHIVE = { key: 'repo:R0077', kind: 'archive', name: 'Zemský archiv ve Smyšlenově' };

function bridgeWaiting(): Record<string, unknown>[] {
    const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
    return [
        {
            id: 'T0001', what: 'Uložit snímky 57–58 oddací matriky Dolní Smyšlenov', kind: 'images', section: 'images', group: ARCHIVE, at, order: 0,
            person: 'P0001', url: 'https://archiv.example/kniha/31',
            inbox: { dir: 'inbox/T0001', have: 1, want: 2, missing: [58], book: 'Oddací matrika N 1858–1871', images: '57–58' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
        {
            id: 'T0002', what: 'Uložit snímky 112–113 křestní matriky Smyšlenov', kind: 'images', section: 'images', group: ARCHIVE, at, order: 1,
            inbox: { dir: 'inbox/T0002', have: 0, want: 2, missing: [112, 113], book: 'Křestní matrika N 1849–1866', images: '112–113' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
        {
            id: 'T0003', what: 'Ověřit zápis v kronice obce Smyšlenov', kind: 'web', section: 'web', at, order: 2,
            group: { key: 'host:smyslenov.example', name: 'smyslenov.example', kind: 'web' }, url: 'https://smyslenov.example/kronika',
            actions: ['answer', 'chat'],
        },
    ];
}

/** The research's images of a task after one more is saved (null: the task is not waiting). */
function saveImage(bridge: Bridge, task: string, n: number): { inbox: Record<string, unknown>; woken: boolean } | null {
    const i = bridge.waiting.findIndex(w => w.id === task);
    if (i < 0) return null;
    const inbox = { ...(bridge.waiting[i].inbox as Record<string, unknown>) };
    const missing = (inbox.missing as number[]).filter(x => x !== n);
    const have = (inbox.have as number) + ((inbox.missing as number[]).includes(n) ? 1 : 0);
    const next = { ...inbox, have, missing };
    if (missing.length === 0) {
        bridge.waiting.splice(i, 1);
        return { inbox: next, woken: true };
    }
    bridge.waiting[i] = { ...bridge.waiting[i], inbox: next };
    return { inbox: next, woken: false };
}

async function follow(page: Page, size: { width: number; height: number }, setup: (b: Bridge) => void = () => {}): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = {
        waiting: bridgeWaiting(), features: ['waiting.groups', 'waiting.answer'], accepts: { media: { taskImages: true } },
        replies: [], puts: [], answers: [],
    };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Hruskovi' }, head: 'h1', persons: 1, working: [], waiting: bridge.waiting, links: LINKS,
        queue: [], features: bridge.features, ...(bridge.accepts ? { accepts: bridge.accepts } : {}),
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        if (path.endsWith('/status')) return route.fulfill(json(200, status()));
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        if (/\/media\/[0-9a-f]{64}$/.test(path) && req.method() === 'PUT') {
            const h = req.headers();
            const put: Put = { task: h['x-strom-task'], image: h['x-strom-image'] ?? null, replace: h['x-strom-replace'] ?? null, name: h['x-strom-name'] ?? null };
            bridge.puts.push(put);
            const next = bridge.replies.shift();
            if (next) return route.fulfill(json(next.status, next.body));
            const n = Number(put.image);
            const saved = saveImage(bridge, put.task, n);
            if (!saved) return route.fulfill(json(404, { error: 'not waiting', code: 'waiting.none' }));
            return route.fulfill(json(200, { task: put.task, image: n, by: 'image', woken: saved.woken, inbox: saved.inbox, added: ['M0101'], head: '' }));
        }
        const write = /\/waiting\/(T\d+)$/.exec(path);
        if (write && req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
            bridge.answers.push({ task: write[1], body });
            const i = bridge.waiting.findIndex(w => w.id === write[1]);
            if (i < 0) return route.fulfill(json(404, { error: 'not waiting', code: 'waiting.none' }));
            bridge.waiting.splice(i, 1);
            return route.fulfill(json(200, { task: write[1], head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    return bridge;
}

async function openOverview(page: Page): Promise<Locator> {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    return ov;
}

async function openItem(page: Page, id: string): Promise<Locator> {
    const head = page.locator('#research-overview .research-overview__waiting-grouphead')
        .filter({ has: page.locator('.research-overview__group-title', { hasText: 'Zemský archiv' }) })
        .locator('.research-overview__waiting-group');
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    const item = page.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`);
    await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

const jpeg = (name: string, bytes = 2048) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.alloc(bytes, name.length) });

/** Files dragged over an element and (unless `drop` is false) dropped on it; whether the element took the drag as its own. */
async function dragFiles(target: Locator, names: string[], drop = true): Promise<boolean> {
    return target.evaluate((node, [list, doDrop]) => {
        const dt = new DataTransfer();
        for (const name of list as string[]) dt.items.add(new File([new Uint8Array(1024)], name, { type: 'image/jpeg' }));
        node.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        node.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const taken = node.classList.contains('is-drop-target');
        if (doDrop) node.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        else node.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return taken;
    }, [names, drop] as const);
}

test.describe('Add images in the overview (accepts.media.taskImages)', () => {
    test('two files numbered by their names go one by one; the task gets its last image and leaves the list', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0002');
        await item.locator('.waiting-actions [data-action="images"]').click();
        const area = item.locator('.waiting-upload');
        await expect(area.locator('.waiting-upload__drop-text')).toHaveText('Drop images here or choose files');
        await expect(area.locator('.waiting-upload__formats')).toHaveText('JPG, PNG, TIFF, HEIC, PDF · up to 500 MB per file');
        // The actions hide while the area is open.
        await expect(item.locator('.waiting-actions')).toHaveCount(0);

        await area.locator('.waiting-upload__input').setInputFiles([jpeg('SOA_N12_0113.jpg'), jpeg('SOA_N12_0112.jpg')]);
        const files = area.locator('.waiting-upload__file');
        await expect(files).toHaveCount(2);
        await expect(files.nth(0).locator('.waiting-upload__num')).toHaveValue('113');
        await expect(files.nth(1).locator('.waiting-upload__num')).toHaveValue('112');
        await expect(files.locator('.waiting-upload__how')).toHaveText(['by file name', 'by file name']);
        const send = area.locator('.waiting-upload__send');
        await expect(send).toHaveText('Send 2 images');
        await expect(send).toHaveAttribute('aria-disabled', 'false');
        await send.click();

        await expect(item).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'All images saved, the task is back in the queue.' })).toBeVisible();
        expect(bridge.puts.map(p => [p.task, p.image, p.replace])).toEqual([['T0002', '113', null], ['T0002', '112', null]]);
        expect(bridge.puts.map(p => p.name)).toEqual(['SOA_N12_0113.jpg', 'SOA_N12_0112.jpg']);
    });

    test('saved already (409 image-exists): Replace sends it again with Replace', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, (b) => {
            b.replies.push({ status: 409, body: { error: 'image exists', code: 'waiting.image-exists', image: 58 } });
        });
        await openOverview(page);
        const item = await openItem(page, 'T0001');
        await item.locator('.waiting-actions [data-action="images"]').click();
        const area = item.locator('.waiting-upload');
        await area.locator('.waiting-upload__input').setInputFiles([jpeg('DS_0058.jpg')]);
        await expect(area.locator('.waiting-upload__num')).toHaveValue('58');
        await area.locator('.waiting-upload__send').click();

        const ask = area.locator('.waiting-upload__ask');
        await expect(ask.locator('.waiting-upload__ask-text')).toHaveText('Image 58 is already saved. Replace it?');
        await ask.locator('.waiting-upload__replace').click();
        await expect(item).toHaveCount(0);
        expect(bridge.puts.map(p => [p.image, p.replace])).toEqual([['58', null], ['58', '1']]);
    });

    test('a number the task does not ask for (409 image-unwanted): the numbers it asks for, another chosen; the task keeps waiting', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, (b) => {
            b.replies.push({ status: 409, body: { error: 'unwanted', code: 'waiting.image-unwanted', want: [112, 113] } });
        });
        await openOverview(page);
        const item = await openItem(page, 'T0002');
        await item.locator('.waiting-actions [data-action="images"]').click();
        const area = item.locator('.waiting-upload');
        await area.locator('.waiting-upload__input').setInputFiles([jpeg('SOA_N12_0113.jpg')]);
        await area.locator('.waiting-upload__send').click();

        const file = area.locator('.waiting-upload__file');
        await expect(file.locator('.waiting-upload__msg.is-warn')).toHaveText('The task asks for images 112–113.');
        const again = file.locator('.waiting-upload__again');
        await again.locator('.waiting-upload__num').selectOption('112');
        await again.locator('.waiting-upload__retry').click();

        // Saved; the task keeps waiting: the area closes, the line says how it stands.
        await expect(area).toHaveCount(0);
        await expect(item.locator('.waiting-images-result')).toHaveText('✓ 1 of 2 images saved – image 113 missing. The task keeps waiting.');
        await expect(item.locator('.waiting-actions [data-action="images"]')).toBeVisible();
        expect(bridge.puts.map(p => p.image)).toEqual(['113', '112']);
        // Folding the detail lets the line go.
        await item.locator('.research-overview__waiting-row').click();
        await item.locator('.research-overview__waiting-row').click();
        await expect(item.locator('.waiting-images-result')).toHaveCount(0);
    });

    test('before sending: a saved number asks Replace, a kind not taken is said; files dropped on a row open its detail', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        const ov = await openOverview(page);
        const head = ov.locator('.research-overview__waiting-grouphead').filter({ hasText: 'Zemský archiv' }).locator('.research-overview__waiting-group');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        // Dragged over: the whole row says where it goes; dropped: the detail opens with the files.
        expect(await dragFiles(item, ['DS_0057.jpg', 'poznamky.docx'], false)).toBe(true);
        await expect(item.locator('.waiting-drop-overlay')).toHaveCount(0);
        await item.evaluate((node) => {
            const dt = new DataTransfer();
            dt.items.add(new File([new Uint8Array(8)], 'DS_0057.jpg', { type: 'image/jpeg' }));
            node.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        await expect(item.locator('.waiting-drop-overlay')).toHaveText('⤓ Drop here: images for this task');
        // The window's own drop hint stays away from a row that takes the files.
        await expect(page.locator('#drop-overlay.active')).toHaveCount(0);
        await dragFiles(item, ['DS_0057.jpg', 'poznamky.docx']);
        await expect(item.locator('.waiting-drop-overlay')).toHaveCount(0);
        const area = item.locator('.waiting-upload');
        await expect(area.locator('.waiting-upload__file')).toHaveCount(2);
        const saved = area.locator('.waiting-upload__file').nth(0);
        await expect(saved.locator('.waiting-upload__ask-text')).toHaveText('Image 57 is already saved. Replace it?');
        await expect(area.locator('.waiting-upload__file').nth(1).locator('.waiting-upload__msg')).toHaveText('The research does not accept DOCX. It will not be sent.');
        const send = area.locator('.waiting-upload__send');
        await expect(send).toHaveAttribute('aria-disabled', 'true');
        await expect(area.locator('.waiting-upload__warn')).toHaveText('1 file needs a decision.');
        await saved.locator('.waiting-upload__replace').click();
        await expect(saved.locator('.waiting-upload__msg')).toHaveText('Replaces saved image 57 (the research keeps the original).');
        await expect(send).toHaveText('Send 1 image');
        await expect(send).toHaveAttribute('aria-disabled', 'false');
        // Cancel: nothing goes, the actions are back.
        await area.locator('.waiting-upload__cancel').click();
        await expect(area).toHaveCount(0);
        await expect(item.locator('.waiting-actions [data-action="images"]')).toBeFocused();
        // A row of another kind takes no files.
        expect(await dragFiles(ov.locator('.research-overview__waiting-item[data-id="T0003"]'), ['DS_0058.jpg'], false)).toBe(false);
    });
});

test.describe('the small panel', () => {
    test('one main action per item; Add images and Answer in a dialog; files dropped on a row', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 });
        const panel = page.locator('#live-panel');
        const row = (id: string) => panel.locator('.live-waiting-row').filter({ has: page.locator(`[data-action]`) }).filter({ hasText: id === 'T0001' ? '57–58' : id === 'T0002' ? '112–113' : 'kronice' });
        await expect(row('T0001').locator('.waiting-images__text')).toHaveText('1 of 2 images');
        const images = row('T0001').locator('.waiting-panel-action');
        await expect(images).toHaveCount(1);
        await expect(images).toHaveText('Add images');
        await expect(images.locator('.research-open-mark')).toHaveCount(0);
        await expect(row('T0003').locator('.waiting-panel-action')).toHaveText('Answer');
        // Two lines of the text beside the one action (§7), the whole text in its title.
        const what = row('T0001').locator('.live-waiting-what');
        const lines = await what.evaluate((e) => {
            const cs = getComputedStyle(e);
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15;
            return Math.floor(e.getBoundingClientRect().height / lh);
        });
        expect(lines).toBeLessThanOrEqual(2);
        await expect(what).toHaveAttribute('title', /57–58/);

        // Dropped on the row: the dialog with the files and their numbers.
        await dragFiles(row('T0002'), ['SOA_N12_0112.jpg', 'SOA_N12_0113.jpg']);
        const dialog = page.locator('.waiting-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.waiting-dialog__title')).toHaveText('Add images');
        await expect(dialog.locator('.waiting-dialog__task')).toHaveText('Uložit snímky 112–113 křestní matriky Smyšlenov');
        await expect(dialog.locator('.waiting-upload__num')).toHaveCount(2);
        // Escape closes it; the files stay for the next time.
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await row('T0002').locator('.waiting-panel-action').click();
        await expect(dialog.locator('.waiting-upload__file')).toHaveCount(2);
        await dialog.locator('.waiting-upload__send').click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'All images saved, the task is back in the queue.' })).toBeVisible();
        expect(bridge.puts.map(p => p.image)).toEqual(['112', '113']);

        // Answer: the form in the dialog; × closes it, the draft stays; sent, the dialog closes.
        await row('T0003').locator('.waiting-panel-action').click();
        await expect(dialog.locator('.waiting-dialog__title')).toHaveText('Answer');
        await dialog.locator('.waiting-answer__text').fill('Kronika je dostupná jen v obecní knihovně.');
        await dialog.locator('.waiting-dialog__close').click();
        await expect(dialog).toHaveCount(0);
        await row('T0003').locator('.waiting-panel-action').click();
        await expect(dialog.locator('.waiting-answer__text')).toHaveValue('Kronika je dostupná jen v obecní knihovně.');
        await dialog.locator('.waiting-answer__send').click();
        await expect(dialog).toHaveCount(0);
        expect(bridge.answers.map(a => [a.task, a.body.text])).toEqual([['T0003', 'Kronika je dostupná jen v obecní knihovně.']]);
    });
});

test.describe('an older bridge without task images', () => {
    test('no Add images and no dropping on a row, in the overview and the small panel', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.accepts = { media: { task: true } }; });
        const panelRow = page.locator('#live-panel .live-waiting-row').filter({ hasText: '57–58' });
        await expect(panelRow.locator('.waiting-panel-action')).toHaveText('Open website ↗');
        expect(await dragFiles(panelRow, ['DS_0058.jpg'], false)).toBe(false);
        await expect(panelRow.locator('.waiting-drop-overlay')).toHaveCount(0);
        await openOverview(page);
        const item = await openItem(page, 'T0001');
        await expect(item.locator('[data-action="images"]')).toHaveCount(0);
        expect(await dragFiles(item, ['DS_0058.jpg'], false)).toBe(false);
        await expect(item.locator('.waiting-drop-overlay')).toHaveCount(0);
        await expect(page.locator('.waiting-upload')).toHaveCount(0);
    });
});

test.describe('a phone in German', () => {
    test.use({ locale: 'de-DE' });
    test('no Add images; the images are added on a computer; Answer in a full-screen sheet; nothing spills', async ({ page }) => {
        const bridge = await follow(page, { width: 390, height: 844 });
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        const head = ov.locator('.research-overview__waiting-grouphead').filter({ hasText: 'Zemský archiv' }).locator('.research-overview__waiting-group');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await item.locator('.research-overview__waiting-row').click();
        await expect(item.locator('.wait-book')).toBeVisible();
        await expect(item.locator('[data-action="images"]')).toHaveCount(0);
        await expect(item.locator('.waiting-more')).toHaveCount(0);
        await expect(item.locator('.waiting-phone-note')).toHaveText(['Bilder werden in der App am Computer hinzugefügt.']);
        expect(await dragFiles(item, ['DS_0058.jpg'], false)).toBe(false);
        const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
            .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
            .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
        expect(spill).toEqual([]);

        // Answer: the whole screen, Cancel · Antwort · Senden on top; the field 16px with its 2px border.
        await item.locator('.waiting-actions [data-action="answer"]').click();
        const sheet = page.locator('.waiting-answer-sheet');
        await expect(sheet).toBeVisible();
        await expect(item.locator('.waiting-answer')).toHaveCount(0);
        const box = await sheet.boundingBox();
        expect(box).toEqual(expect.objectContaining({ x: 0, y: 0, width: 390 }));
        expect(box!.height).toBeGreaterThan(800);
        await expect(sheet.locator('.waiting-answer-sheet__task')).toHaveText('Uložit snímky 57–58 oddací matriky Dolní Smyšlenov');
        const send = sheet.locator('.waiting-answer-sheet__send');
        await expect(send).toHaveAttribute('aria-disabled', 'true');
        const field = sheet.locator('.waiting-answer__text');
        await expect(field).toBeFocused();
        expect(await field.evaluate(n => getComputedStyle(n).fontSize)).toBe('16px');
        const headSpill = await sheet.locator('.waiting-answer-sheet__head').evaluate(n => n.scrollWidth - n.clientWidth);
        expect(headSpill).toBeLessThanOrEqual(0);
        // Cancel keeps the draft; opened again, it is there; Send takes it.
        await field.fill('Snímek 58 v archivu chybí.');
        await sheet.locator('.waiting-answer-sheet__cancel').click();
        await expect(sheet).toHaveCount(0);
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await expect(sheet.locator('.waiting-answer__text')).toHaveValue('Snímek 58 v archivu chybí.');
        await expect(send).toHaveAttribute('aria-disabled', 'false');
        await send.click();
        await expect(sheet).toHaveCount(0);
        await expect(item).toHaveCount(0);
        expect(bridge.answers.map(a => [a.task, a.body.text])).toEqual([['T0001', 'Snímek 58 v archivu chybí.']]);
    });

    test('without waiting.answer: the website and where answers are given', async ({ page }) => {
        await follow(page, { width: 390, height: 844 }, (b) => { b.features = ['waiting.groups']; });
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        const head = ov.locator('.research-overview__waiting-grouphead').filter({ hasText: 'Zemský archiv' }).locator('.research-overview__waiting-group');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await item.locator('.research-overview__waiting-row').click();
        await expect(item.locator('.waiting-actions > .waiting-action')).toHaveText(['Website öffnen ↗']);
        await expect(item.locator('.waiting-phone-note')).toHaveCount(2);
    });
});

test.describe('German at a tablet\'s width', () => {
    test.use({ locale: 'de-DE' });
    test('the upload area in the overview and the panel\'s dialog: the longest labels wrap, nothing spills sideways', async ({ page }) => {
        await follow(page, { width: 1024, height: 768 });
        const spills = (host: Locator) => host.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
            .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
            .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
        // The panel's dialog first (the overview closed).
        const panelRow = page.locator('#live-panel .live-waiting-row').filter({ hasText: '57–58' });
        await expect(panelRow.locator('.waiting-panel-action')).toHaveText('Bilder hinzufügen');
        expect(await spills(panelRow)).toEqual([]);
        await dragFiles(panelRow, ['Zemsky_archiv_Smyslenov_oddaci_matrika_N_1858-1871_snimek_0057.jpg', 'DS_0058.jpg', 'poznamky.docx']);
        const dialog = page.locator('.waiting-dialog');
        await expect(dialog.locator('.waiting-upload__file')).toHaveCount(3);
        expect(await spills(dialog)).toEqual([]);
        const box = await dialog.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
        await dialog.locator('.waiting-upload__cancel').click();
        await expect(dialog).toHaveCount(0);

        await openOverview(page);
        const item = await openItem(page, 'T0001');
        await item.locator('.waiting-actions [data-action="images"]').click();
        await item.locator('.waiting-upload__input').setInputFiles([jpeg('Zemsky_archiv_Smyslenov_oddaci_matrika_N_1858-1871_snimek_0057.jpg'), jpeg('DS_0058.jpg')]);
        await expect(item.locator('.waiting-upload__file')).toHaveCount(2);
        expect(await spills(item)).toEqual([]);
        const ovBody = page.locator('#research-overview .research-overview__body');
        expect(await ovBody.evaluate((b) => b.scrollWidth - b.clientWidth)).toBeLessThanOrEqual(0);
    });
});
