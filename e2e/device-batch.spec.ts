import { test, expect, Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen, card } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * Add materials on a device of the home network (spec 094 P3 §5): a phone
 * takes or picks photos (Take photo / From gallery), sees them in a grid of
 * three with × on each, hands them over with a person and a short note; each
 * goes by PUT /device/media to the fake gateway (sealed by blocks) and shows
 * its state; a failure says why and Try again sends it; the sheet closed, the
 * batch goes on and the More sheet's research group shows how far; photos not
 * handed over yet come back after a reload; a computer that takes no files of
 * devices keeps them on the device with a quiet sentence. Invented data only
 * (the Pýchavkovi of Mlýnky, the computer "Pracovna").
 */

const TREE = '7c3e1f20-5a4b-4d6e-9f80-1a2b3c4d5e6f';
const HEAD = '5d2e8a7c1b94';
const PNG = readFileSync('e2e/fixtures/avatar.png');
/** A photo: the PNG with a tail of its own (each its own SHA-256, still an image). */
function photo(name: string, n: number): { name: string; mimeType: string; buffer: Buffer } {
    return { name, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from(`mlynky-${n}`)]) };
}
const ACCEPTS = {
    mode: 'research', sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } },
};
const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const FEATURES = ['device.gateway', 'material.list'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${TREE}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Pýchavkovi z Mlýnků',
    '0 @P0001@ INDI', '1 NAME Bonifác /Pýchavka/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Holubinka /Ryzcová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Hřibík /Pýchavka/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');

let gw: FakeGateway;
/** Whether the gateway announces `media.put` (sends files of a device). */
let mediaPut = true;
/** Every `batch/<id>/done` the bridge got. */
let closed: DeviceRequest[] = [];

function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') {
        return { s: 200, body: {
            ok: true, tree: { id: TREE, name: 'Pýchavkovi z Mlýnků' }, head: HEAD, links: LINKS, accepts: ACCEPTS,
            inbox: { trees: [], material: 0 }, lastIntake: null, sends: [], waiting: [], features: FEATURES,
            device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair', ...(mediaPut ? ['media.put'] : [])] },
        } };
    }
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (/^batch\/[^/]+\/done$/.test(req.p)) {
        closed.push(req);
        return { s: 200, body: { ok: true, inputs: gw.media.length, known: 0, refused: 0, tasks: [] } };
    }
    return undefined;
}

test.beforeEach(async () => {
    mediaPut = true;
    closed = [];
    gw = await startDeviceGateway();
    gw.trees = [{ id: TREE, name: 'Pýchavkovi z Mlýnků', archive: false }];
    gw.onTunnel = bridge;
});
test.afterEach(async () => {
    await gw.close();
});

async function pairedTree(page: Page, opts: { lang: 'en' | 'de'; width: number; dark?: boolean }): Promise<void> {
    await page.setViewportSize({ width: opts.width, height: opts.width < 641 ? 844 : 900 });
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    // A fixed clock away from midnight; the gateway's own clock agrees with it (no clock retry of a request).
    const fixed = new Date('2026-11-24T10:00:00Z').getTime();
    await page.clock.setFixedTime(fixed);
    gw.clockOffsetMs = fixed - Date.now();
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await seedSetting(page, 'onThisDay', false);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom.map.timeTipSeen', '1');
        } catch { /* none */ }
    });
    await page.goto(gw.pairCode().url);
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.waitForFunction(() => {
        const d = (globalThis as { __stromDevice?: { connection(): { state: string } | null } }).__stromDevice;
        return d?.connection()?.state === 'connected';
    });
    // The start opens the research's tree itself (tree.ged through the gateway).
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 15000 });
    await expect(card(page, 'Hřibík')).toBeVisible();
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ modeAsked: true, skipPreview: true, placesOffer: 'done' }));
    });
    if (opts.lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await poll(page);
}

async function openBatch(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showBatchDialog());
    await expect(page.locator('#batch-modal .batch-dialog')).toBeVisible();
}

/** Nothing inside the dialog past its right edge or the window's. */
async function overflowing(page: Page, sel: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement | null;
        if (!root) return ['(none)'];
        const out: string[] = [];
        const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth) + 1;
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > edge && getComputedStyle(el).visibility !== 'hidden') out.push(`${el.className || el.tagName}: ${Math.round(r.right)} > ${Math.round(edge)}`);
        }
        if (document.documentElement.scrollWidth > window.innerWidth) out.push('page scrolls sideways');
        return out;
    }, sel);
}

/** Buttons under 44 px on a touch device (×, tiles, the footer's). */
async function smallTargets(page: Page, sel: string): Promise<string[]> {
    return page.locator(sel).evaluateAll(els => els.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.height < 44 || r.width < 32);
    }).map(el => `${el.className}: ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`));
}

const DLG = '#batch-modal .batch-dialog';

test.describe('a phone of the home network (touch)', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('takes and picks photos, removes one, keeps them over a reload, hands them over with a person and note, each in the research', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await openBatch(page);
        const dlg = page.locator(DLG);
        await expect(dlg).toHaveClass(/batch-device/);
        // Choose: two tiles (no Choose files on a phone); the camera's input takes a picture.
        await expect(dlg.locator('.batch-tiles .batch-tile')).toHaveText(['Take photo', 'From gallery']);
        await expect(dlg.locator('#batch-input-camera')).toHaveAttribute('capture', 'environment');
        await expect(dlg.locator('#batch-input-camera')).toHaveAttribute('accept', 'image/*');
        await expect(dlg.locator('#batch-input-gallery')).toHaveAttribute('multiple', '');
        expect(await smallTargets(page, `${DLG} .batch-tile`)).toEqual([]);
        // Full screen.
        const box = (await dlg.boundingBox())!;
        expect(Math.round(box.width)).toBe(390);
        await dlg.locator('#batch-input-camera').setInputFiles([photo('IMG_2036.png', 1)]);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2037.png', 2), photo('IMG_2038.png', 3), photo('IMG_2039.png', 4)]);
        const cells = dlg.locator('.batch-grid .batch-cell:not(.batch-cell-add)');
        await expect(cells).toHaveCount(4);
        await expect(cells.locator('img').first()).toHaveAttribute('src', /^blob:/);
        await expect(dlg.locator('.batch-cell-add .batch-tile')).toHaveText(['Take another', 'From gallery']);
        await expect(dlg.locator('.batch-grid-count')).toContainText('4 photos');
        const x = await dlg.locator('.batch-cell-x').first().boundingBox();
        expect(Math.round(x!.width)).toBe(32);
        await dlg.locator('.batch-cell-x[aria-label="Remove IMG_2039.png"]').tap();
        await expect(cells).toHaveCount(3);
        expect(await overflowing(page, DLG)).toEqual([]);
        mkdirSync('snimky', { recursive: true });
        await page.screenshot({ path: 'snimky/d6-grid-en-390.png' });

        // A reload: the photos chosen are back from the device's queue.
        await page.reload();
        await page.waitForFunction(() => (globalThis as { __stromDevice?: { connection(): { state: string } | null } }).__stromDevice?.connection()?.state === 'connected');
        await poll(page);
        await openBatch(page);
        await expect(cells).toHaveCount(3);
        await expect(dlg.locator('.batch-grid-count')).toContainText('3 photos');

        // The hand-over: the person picked, then shown with ×; the note of 200 with its counter.
        await dlg.locator('[data-act="next"]').tap();
        await dlg.locator('.person-picker-input').fill('Bonifác');
        await page.locator('.person-picker-item', { hasText: 'Bonifác' }).first().tap();
        await expect(dlg.locator('.batch-person-name')).toHaveText('Bonifác Pýchavka');
        await expect(dlg.locator('.batch-chip-x')).toBeVisible();
        const note = dlg.locator('#batch-note');
        await expect(note).toHaveAttribute('maxlength', '200');
        await note.fill('Hřbitov v Mlýnkách');
        await expect(dlg.locator('.batch-note-count')).toHaveText('18 / 200');
        expect(await overflowing(page, DLG)).toEqual([]);
        await page.screenshot({ path: 'snimky/d6-handover-en-390.png' });
        await dlg.locator('[data-act="go"]').tap();
        await expect(dlg.locator('.batch-confirm-title')).toHaveText('✓ 3 of 3 photos are in the research');
        await expect(dlg.locator('.batch-done-text')).toHaveText('Sorting by the agent is started on the computer with the research.');
        await page.screenshot({ path: 'snimky/d6-done-en-390.png' });

        // Through the gateway's media route, sealed: the person and name only in the meta block.
        expect(gw.media.map(m => decodeURIComponent(String(m.meta['X-Strom-Name'])))).toEqual(['IMG_2036.png', 'IMG_2037.png', 'IMG_2038.png']);
        expect(gw.media.every(m => m.tree === TREE && m.meta['X-Strom-Person'] === 'P0001')).toBe(true);
        expect(closed).toHaveLength(1);
        const body = closed[0].b;
        expect(typeof body === 'string' ? JSON.parse(body) : body).toMatchObject({ person: 'P0001', note: 'Hřbitov v Mlýnkách' });
        // Nothing left in the queue: a new batch starts empty.
        await dlg.locator('.batch-footer [data-act="close"]').tap();
        await openBatch(page);
        await expect(dlg.locator('.batch-tiles')).toBeVisible();
    });

    test('a failed photo says why, Try again sends it; the sheet closed, the batch goes on in the More sheet', async ({ page }) => {
        let refuse = true;
        gw.onMedia = (m) => {
            if (refuse && String(m.meta['X-Strom-Name']).includes('IMG_2041')) { refuse = false; return { s: 415, body: { code: 'media.type', error: 'Unsupported file type.' } }; }
            return undefined;
        };
        // The second photo held until the test lets it go (the sheet closed meanwhile).
        let release!: () => void;
        const held = new Promise<void>(r => { release = r; });
        let puts = 0;
        await pairedTree(page, { lang: 'en', width: 390 });
        await page.route('**/device/media/**', async route => {
            if (++puts === 2) await held;
            await route.continue();
        });
        await openBatch(page);
        const dlg = page.locator(DLG);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2040.png', 10), photo('IMG_2041.png', 11), photo('IMG_2042.png', 12)]);
        await dlg.locator('[data-act="next"]').tap();
        await dlg.locator('[data-act="go"]').tap();
        await expect(dlg.locator('.batch-photo-row').first()).toHaveClass(/is-in/);
        await expect(dlg.locator('.batch-progress-count')).toHaveText('1 of 3 sent');
        await expect(dlg.locator('.batch-keep-tab')).toHaveText('Sending continues after the sheet is closed; progress is in the Research group of More.');
        expect(await overflowing(page, DLG)).toEqual([]);
        await page.screenshot({ path: 'snimky/d6-sending-en-390.png' });
        // Closed: the More sheet's research group has its row; it opens the list again.
        await dlg.locator('[data-act="hide"]').tap();
        await expect(page.locator('#batch-modal')).toBeHidden();
        await page.locator('#bb-view-more').tap();
        const row = page.locator('#sheet-batch-sending');
        await expect(row).toContainText('Sending to the research');
        await expect(row).toContainText('1 of 3');
        release();
        await row.tap();
        await expect(dlg.locator('.batch-photo-row.is-error .batch-photo-why')).toHaveText('Unsupported file type.');
        await expect(dlg.locator('.batch-confirm-title')).toHaveText('2 of 3 photos are in the research');
        await page.screenshot({ path: 'snimky/d6-error-en-390.png' });
        await dlg.locator('[data-act="retry-failed"]').tap();
        await expect(dlg.locator('.batch-confirm-title')).toHaveText('✓ 1 of 1 photo is in the research');
        expect(gw.media.map(m => decodeURIComponent(String(m.meta['X-Strom-Name'])))).toEqual(['IMG_2040.png', 'IMG_2042.png', 'IMG_2041.png']);
    });

    test('a photo cut off on the way goes on from the blocks the computer has, waits while another file of the device goes, and is sent again from the start when its hash did not hold; a file of 0 B is refused as empty', async ({ page }) => {
        // 2.5 MiB: three blocks of the gateway's PUT /device/media (U9c).
        const big = { name: 'IMG_2050.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.alloc(2.5 * 1024 * 1024, 7)]) };
        const empty = { name: 'IMG_2051.png', mimeType: 'image/png', buffer: Buffer.alloc(0) };
        await pairedTree(page, { lang: 'en', width: 390 });
        await openBatch(page);
        const dlg = page.locator(DLG);
        // The first request: block 1 kept, then the connection ends without an answer; going on (the batch
        // pauses and goes on by itself) the gateway is asked what it has, is busy with another file of the
        // device once, then the hash does not hold.
        gw.mediaSteps = [{ cutAfter: 1 }, 'busy', 'badHash'];
        await dlg.locator('#batch-input-gallery').setInputFiles([big, empty]);
        await dlg.locator('[data-act="next"]').tap();
        await dlg.locator('[data-act="go"]').tap();
        await expect(dlg.locator('.batch-confirm-title')).toHaveText('1 of 2 photos is in the research', { timeout: 20000 });
        const sha = gw.mediaRequests[0].sha;
        expect(gw.tunnelled.filter(r => r.p.startsWith('device/media/')).map(r => `${r.m} ${r.p}`)).toEqual([`GET device/media/${sha}`]);
        expect(gw.mediaRequests.map(r => [r.from, r.blocks])).toEqual([[0, [1, 2, 3]], [1, [2, 3]], [1, [2, 3]], [0, [1, 2, 3]]]);
        // Nothing of the file in the open headers: no batch, no name; the meta block has them.
        expect(Object.keys(gw.mediaRequests[0].headers).filter(k => k.startsWith('x-strom-')).sort()).toEqual(
            ['x-strom-app-version', 'x-strom-device', 'x-strom-from', 'x-strom-nonce', 'x-strom-size', 'x-strom-time', 'x-strom-tree']);
        expect(gw.media).toHaveLength(1);
        expect(decodeURIComponent(gw.media[0].meta['X-Strom-Name'])).toBe('IMG_2050.png');
        expect(gw.media[0].meta['X-Strom-Batch']).toBeTruthy();
        expect(gw.media[0].bytes.equals(big.buffer)).toBe(true);
        // The file of 0 B never went: refused here as empty.
        await expect(dlg.locator('.batch-photo-row.is-error .batch-photo-why')).toHaveText('the file is empty (0 B)');
        expect(await overflowing(page, DLG)).toEqual([]);
    });

    test('a computer that takes no files of devices: the photos stay on the device with a quiet sentence, also after a reload', async ({ page }) => {
        mediaPut = false;
        await pairedTree(page, { lang: 'en', width: 390 });
        await openBatch(page);
        const dlg = page.locator(DLG);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2050.png', 20), photo('IMG_2051.png', 21)]);
        await dlg.locator('[data-act="next"]').tap();
        await dlg.locator('[data-act="go"]').tap();
        await expect(dlg.locator('.batch-held-note')).toHaveText('The computer with the research does not take photos from devices yet; they stay saved on this device.');
        // No greyed-out button: only Done.
        await expect(dlg.locator('.batch-footer button')).toHaveText(['Done']);
        expect(gw.media).toEqual([]);
        await page.reload();
        await page.waitForFunction(() => (globalThis as { __stromDevice?: { connection(): { state: string } | null } }).__stromDevice?.connection()?.state === 'connected');
        await poll(page);
        await openBatch(page);
        await expect(dlg.locator('.batch-grid .batch-cell:not(.batch-cell-add)')).toHaveCount(2);
    });
});

/** The look in en and de, a phone, a tablet (touch) and a second computer (mouse), light and dark: nothing overflows. */
for (const lang of ['en', 'de'] as const) {
    for (const width of [390, 1024, 1440]) {
        for (const dark of [false, true]) {
            test.describe(`${lang} ${width}${dark ? ' dark' : ''}`, () => {
                if (width < 1440) test.use({ hasTouch: true, isMobile: true });
                test('the steps fit, nothing overflows', async ({ page }) => {
                    await pairedTree(page, { lang, width, dark });
                    await openBatch(page);
                    const dlg = page.locator(DLG);
                    const touch = width < 1440;
                    await expect(dlg).toHaveClass(touch ? /batch-device/ : /^(?!.*batch-device)/);
                    if (touch) await expect(dlg.locator('.batch-tiles .batch-tile')).toHaveCount(width === 1024 ? 3 : 2);
                    expect(await overflowing(page, DLG)).toEqual([]);
                    const files = [photo('IMG_2060.png', 30), photo('Hrbitov_Mlynky_nahrobek_Bonifac_Pychavka_1924.png', 31)];
                    await dlg.locator(touch ? '#batch-input-gallery' : '#batch-input-files').setInputFiles(files);
                    if (touch) await expect(dlg.locator('.batch-grid .batch-cell:not(.batch-cell-add)')).toHaveCount(2);
                    else await expect(dlg.locator('.batch-file')).toHaveCount(2);
                    expect(await overflowing(page, DLG)).toEqual([]);
                    const shot = (step: string) => (lang === 'de' && (width === 390 || width === 1440))
                        ? page.screenshot({ path: `snimky/d6-${step}-${lang}-${width}${dark ? '-dark' : ''}.png` }) : Promise.resolve();
                    await shot('grid');
                    await dlg.locator('[data-act="next"]').click();
                    await expect(dlg.locator('[data-act="go"]')).toBeVisible();
                    expect(await overflowing(page, DLG)).toEqual([]);
                    await shot('handover');
                    await dlg.locator('[data-act="go"]').click();
                    await expect(dlg.locator('.batch-done, .batch-done-text').first()).toBeVisible();
                    expect(await overflowing(page, DLG)).toEqual([]);
                    await shot('done');
                    if (touch) expect(await smallTargets(page, `${DLG} .batch-footer button`)).toEqual([]);
                    expect(gw.media).toHaveLength(2);
                });
            });
        }
    }
}
