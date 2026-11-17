/**
 * The portrait editor from the person dialog (spec 107 §1, §3, §9, §10): a
 * chosen file opens the editor over the dialog; Done shows the portrait in
 * the dialog and Save keeps the whole photo as an attachment with the
 * portrait naming it; Cancel and Escape close the editor only. The frame
 * stays, the photo moves: drag, wheel, keys, two fingers; turn, straighten,
 * mirror. Done untouched gives exactly today's portrait (K1.5).
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, seedTree } from './helpers.js';
import { calibrationWorkload, machineFactor, normalizedMs } from '../src/__tests__/helpers/perf-budget';

const editor = (page: Page) => page.locator('.pe-overlay');
const pct = (page: Page) => editor(page).locator('.pe-pct');

/** A PNG of four coloured quarters (red, blue / green, yellow), so every turn and mirror shows. */
async function quartersPng(page: Page, w: number, h: number): Promise<Buffer> {
    const b64 = await page.evaluate(([w, h]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d')!;
        const fill = (col: string, l: number, t: number) => { x.fillStyle = col; x.fillRect(l, t, w / 2, h / 2); };
        fill('#c0392b', 0, 0);
        fill('#2980b9', w / 2, 0);
        fill('#27ae60', 0, h / 2);
        fill('#f1c40f', w / 2, h / 2);
        // A diagonal so the photo never looks the same after a move.
        x.strokeStyle = '#000';
        x.lineWidth = Math.max(4, w / 100);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.stroke();
        return c.toDataURL('image/png').split(',')[1];
    }, [w, h]);
    return Buffer.from(b64, 'base64');
}

/** compressPhoto as it is (src/photo.ts): the centred square at 256 px, JPEG 0.8. */
async function todaysPortrait(page: Page, png: Buffer): Promise<string> {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new File([bytes], 'x.png', { type: 'image/png' }), { imageOrientation: 'from-image' });
        const size = Math.min(bitmap.width, bitmap.height);
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        c.getContext('2d')!.drawImage(bitmap, Math.round((bitmap.width - size) / 2), Math.round((bitmap.height - size) / 2), size, size, 0, 0, 256, 256);
        return c.toDataURL('image/jpeg', 0.8);
    }, png.toString('base64'));
}

async function openForZbyhoslav(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, { zb: { firstName: 'Zbyhoslav', lastName: 'Brumlik', birthDate: '1931' } });
    await cardAction(page, 'Zbyhoslav', 'edit');
    await expect(personModal(page)).toBeVisible();
}

async function choose(page: Page, png: Buffer, name = 'zbyhoslav.png'): Promise<void> {
    // A Done before still computing would leave the dialog without its portrait yet.
    await expect(editor(page)).toHaveCount(0);
    await personModal(page).locator('#input-photo').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    await expect(editor(page)).toBeVisible();
    await expect(editor(page).locator('.pe-frame')).toBeFocused();
}

const stored = (page: Page) => page.evaluate(() => {
    const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Zbyhoslav')!;
    return { photo: p.photo, source: p.photoSource, attachments: window.Strom.DataManager.personMedia(p.id) };
});

test.describe('portrait editor (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Done untouched: today\'s portrait bytes; Save adds the whole photo as an attachment and the portrait names it', async ({ page }) => {
        await openForZbyhoslav(page);
        const png = await quartersPng(page, 900, 600);
        await choose(page, png);
        // The fixed frame in the card photo's shape, the card preview with the person, 100 %.
        await expect(editor(page).getByRole('heading', { name: 'Portrait crop' })).toBeVisible();
        await expect(editor(page).locator('.pe-who')).toHaveText('· Zbyhoslav Brumlik');
        await expect(editor(page).locator('.pe-card-box .name-text')).toHaveText('Zbyhoslav Brumlik');
        await expect(pct(page)).toHaveText('100 %');
        await expect(editor(page).locator('.pe-saved')).toHaveText('A circle on the card; the whole square is saved.');
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        const preview = await personModal(page).locator('#photo-preview img').getAttribute('src');
        expect(preview).toBe(await todaysPortrait(page, png));
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        await expect(personModal(page)).toBeHidden();
        const s = await stored(page);
        expect(s.photo).toBe(preview);
        expect(s.attachments).toHaveLength(1);
        expect(s.attachments[0]).toMatchObject({ name: 'zbyhoslav.png', mimeType: 'image/jpeg' });
        expect(s.attachments[0].dataUrl).toMatch(/^data:image\/jpeg/);
        const size = await page.evaluate((u) => new Promise<number[]>(r => {
            const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = u;
        }), s.attachments[0].dataUrl);
        expect(size).toEqual([900, 600]);
        expect(s.source).toMatchObject({ attachmentId: s.attachments[0].id });
        expect(s.source!.region.w * 900).toBeCloseTo(600, 0);
        expect(s.source!.region.x).toBeCloseTo(150 / 900, 3);
    });

    test('keys on the frame: arrows move the photo, + − zoom, [ ] turn, 0 the default, Enter is Done; Escape closes only the editor', async ({ page }) => {
        await openForZbyhoslav(page);
        const png = await quartersPng(page, 900, 600);
        await choose(page, png);
        const frame = editor(page).locator('.pe-frame');
        await page.keyboard.press('+');
        await expect(pct(page)).toHaveText('110 %');
        await page.keyboard.press('+');
        await expect(pct(page)).toHaveText('121 %');
        await page.keyboard.press('-');
        await expect(pct(page)).toHaveText('110 %');
        await expect(editor(page).locator('.pe-zoom-range')).toHaveAttribute('aria-valuetext', '110 %');
        // The screen reader hears the zoom once it settles.
        await expect(editor(page).locator('.pe-live')).toHaveText('Zoom 110 %');
        await page.keyboard.press('0');
        await expect(pct(page)).toHaveText('100 %');
        // A wide photo at 100 % moves only sideways: Shift+→ moves the photo right (the crop goes left).
        await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press(']');
        await expect(frame).toBeFocused();
        // Escape: the editor goes, the dialog stays with no photo.
        await page.keyboard.press('Escape');
        await expect(editor(page)).toHaveCount(0);
        await expect(personModal(page)).toBeVisible();
        await expect(personModal(page).locator('#photo-preview img')).toHaveCount(0);

        await choose(page, png);
        await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press(']');
        await page.keyboard.press('Enter');
        await expect(editor(page)).toHaveCount(0);
        await expect(personModal(page)).toBeVisible();
        const preview = await personModal(page).locator('#photo-preview img').getAttribute('src');
        expect(preview).toMatch(/^data:image\/jpeg/);
        expect(preview).not.toBe(await todaysPortrait(page, png));
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        const s = await stored(page);
        // The crop's centre moved 60 px left (10 % of the 600 px the frame covers), then turned
        // clockwise onto a 600 × 900 page: (x, y) → (600 − y, x), so its top is 390 − 300.
        expect(s.source).toMatchObject({ quarterTurns: 1 });
        expect(s.source!.region.y * 900).toBeCloseTo(90, 0);
    });

    test('drag, the wheel, turn, straighten with the grid and mirror; the crop is saved as set', async ({ page }) => {
        await openForZbyhoslav(page);
        await choose(page, await quartersPng(page, 900, 600));
        const stage = editor(page).locator('.pe-stage');
        const box = (await editor(page).locator('.pe-frame').boundingBox())!;
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        // The wheel zooms about the pointer.
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, -100);
        await expect(pct(page)).toHaveText('115 %');
        // Dragged left: the photo follows, the crop moves right.
        await page.mouse.down();
        await page.mouse.move(cx - 60, cy, { steps: 4 });
        await page.mouse.up();
        // ↻ turns (zoom back to covering), Flip mirrors.
        await editor(page).getByRole('button', { name: 'Rotate right' }).click();
        await expect(pct(page)).toHaveText('100 %');
        const flip = editor(page).getByRole('button', { name: 'Flip' });
        await flip.click();
        await expect(flip).toHaveAttribute('aria-pressed', 'true');
        // Straighten: Shift+→ is 5°, the grid shows while the slider has the focus.
        const angle = editor(page).locator('.pe-angle-range');
        await angle.focus();
        await expect(editor(page).locator('.pe-grid')).toBeVisible();
        await page.keyboard.press('Shift+ArrowRight');
        await expect(editor(page).locator('.pe-deg')).toHaveText('5°');
        await expect(angle).toHaveAttribute('aria-valuetext', '5°');
        // Straightening zooms in so the frame stays covered.
        await expect.poll(async () => Number((await pct(page).textContent())!.replace(/\D/g, ''))).toBeGreaterThan(100);
        await stage.dblclick({ position: { x: 20, y: 20 } });
        await expect(editor(page).locator('.pe-deg')).toHaveText('0°');
        await expect(flip).toHaveAttribute('aria-pressed', 'false');
        // Set them again and keep them (mirrored first: a mirror after an odd turn adds two more).
        await flip.click();
        await editor(page).getByRole('button', { name: 'Rotate left' }).click();
        await angle.focus();
        await page.keyboard.press('Shift+ArrowLeft');
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        const s = await stored(page);
        expect(s.source).toMatchObject({ quarterTurns: 3, angle: -5, mirror: true });
    });

    test('the sliders are the app\'s green in the light and the dark theme, never the system blue', async ({ page }) => {
        await openForZbyhoslav(page);
        await choose(page, await quartersPng(page, 900, 600));
        /** Each slider's accent colour and the theme's primary green, both as the browser computes them. */
        const colors = () => page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--primary)';
            document.body.append(probe);
            const primary = getComputedStyle(probe).color;
            probe.remove();
            const accent = (sel: string) => getComputedStyle(document.querySelector(sel)!).accentColor;
            return { primary, zoom: accent('.pe-zoom-range'), angle: accent('.pe-angle-range') };
        });
        const light = await colors();
        expect(light.zoom).toBe(light.primary);
        expect(light.angle).toBe(light.primary);
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const dark = await colors();
        expect(dark.primary).not.toBe(light.primary);
        expect(dark.zoom).toBe(dark.primary);
        expect(dark.angle).toBe(dark.primary);
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));
    });

    test('Cancel keeps the dialog as it was; the dialog closed without Save keeps nothing', async ({ page }) => {
        await openForZbyhoslav(page);
        const png = await quartersPng(page, 600, 600);
        await choose(page, png);
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(editor(page)).toHaveCount(0);
        await expect(personModal(page)).toBeVisible();
        await expect(personModal(page).locator('#photo-preview img')).toHaveCount(0);
        // Done, then the dialog closed without saving: no portrait, no attachment.
        await choose(page, png);
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(personModal(page).locator('#photo-preview img')).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        await cardAction(page, 'Zbyhoslav', 'edit');
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        const s = await stored(page);
        expect(s.photo).toBeFalsy();
        expect(s.attachments).toHaveLength(0);
        // A portrait removed before Save leaves no attachment either.
        await cardAction(page, 'Zbyhoslav', 'edit');
        await choose(page, png);
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await personModal(page).locator('#photo-remove-btn').click();
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        expect((await stored(page)).attachments).toHaveLength(0);
    });

    test('a file that is not an image: the dialog says so and no editor opens', async ({ page }) => {
        await openForZbyhoslav(page);
        await personModal(page).locator('#input-photo').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
        await expect(page.locator('#confirmation-modal')).toContainText('Could not process the image.');
        await expect(editor(page)).toHaveCount(0);
    });

    test('a person with a portrait: Current → New; a small photo warns', async ({ page }) => {
        await openForZbyhoslav(page);
        await choose(page, await quartersPng(page, 600, 600));
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await choose(page, await quartersPng(page, 300, 200));
        await expect(editor(page).locator('.pe-note-replace')).toContainText('This person already has a portrait.');
        await expect(editor(page).locator('.pe-note-small')).toHaveText('The photo is small; the portrait may be blurry.');
        await page.keyboard.press('Escape');
        await choose(page, await quartersPng(page, 900, 600));
        await expect(editor(page).locator('.pe-note-small')).toBeHidden();
        // Zoomed in until fewer than 256 px of the photo are in the frame (600 / 1.1⁹ ≈ 254).
        for (let i = 0; i < 9; i++) await page.keyboard.press('+');
        await expect(editor(page).locator('.pe-note-small')).toBeVisible();
    });
});

test.describe('portrait editor (phone)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the whole screen, the Zoom | Straighten switch, two fingers zoom, Done in the row under the slider', async ({ page }) => {
        await openForZbyhoslav(page);
        await personModal(page).locator('#input-photo').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await quartersPng(page, 900, 600) });
        await expect(editor(page)).toBeVisible();
        const dialog = editor(page).locator('.pe-dialog');
        const d = (await dialog.boundingBox())!;
        expect(d.width).toBe(390);
        expect(d.height).toBe(844);
        const frame = (await editor(page).locator('.pe-frame').boundingBox())!;
        expect(frame.width).toBeCloseTo(358, 0);
        await expect(editor(page).locator('.pe-keys')).toBeHidden();
        // One slider at a time.
        await expect(editor(page).locator('.pe-zoom')).toBeVisible();
        await expect(editor(page).locator('.pe-angle')).toBeHidden();
        await editor(page).getByRole('button', { name: 'Straighten' }).click();
        await expect(editor(page).locator('.pe-angle')).toBeVisible();
        await expect(editor(page).locator('.pe-zoom')).toBeHidden();
        await editor(page).getByRole('button', { name: 'Zoom', exact: true }).click();
        // Two fingers apart: the photo zooms in.
        const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
        await page.evaluate(({ cx, cy }) => {
            const stage = document.querySelector('.pe-stage')!;
            const fire = (type: string, id: number, x: number, y: number) => stage.dispatchEvent(new PointerEvent(type, {
                pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1,
            }));
            fire('pointerdown', 1, cx - 30, cy);
            fire('pointerdown', 2, cx + 30, cy);
            for (let i = 1; i <= 5; i++) { fire('pointermove', 1, cx - 30 - i * 6, cy); fire('pointermove', 2, cx + 30 + i * 6, cy); }
            fire('pointerup', 1, cx - 60, cy);
            fire('pointerup', 2, cx + 60, cy);
        }, { cx, cy });
        await expect(pct(page)).toHaveText('200 %');
        const done = editor(page).locator('.pe-actions').getByRole('button', { name: 'Done' });
        await expect(done).toBeVisible();
        const b = (await done.boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.x + b.width).toBeLessThanOrEqual(390);
        await done.click();
        await expect(editor(page)).toHaveCount(0);
        await expect(personModal(page).locator('#photo-preview img')).toHaveCount(1);
    });
});

test.describe('portrait editor (tablet)', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

    test('the panel is 264 px beside the stage, no keys hint', async ({ page }) => {
        await openForZbyhoslav(page);
        await choose(page, await quartersPng(page, 900, 600));
        const panel = (await editor(page).locator('.pe-panel').boundingBox())!;
        expect(Math.round(panel.width)).toBe(264);
        await expect(editor(page).locator('.pe-keys')).toBeHidden();
        await expect(editor(page).locator('.pe-foot').getByRole('button', { name: 'Done' })).toBeVisible();
    });
});

/** The calibration (src/__tests__/helpers/perf-budget.ts): rounds of the workload and its time on the reference machine at rest. */
const PERF_CALIBRATION_ROUNDS = 16;
const PERF_CALIBRATION_REFERENCE_MS = 155;
/**
 * A 4 000 × 3 000 photo on the reference machine at rest (normalized ms):
 * the editor open and drawn, and Done with the portrait and the 1 600 px
 * original: about 85 and 50 ms there (16 Nov 2026), so the budget catches a
 * run about five times slower.
 */
const PERF_OPEN_BUDGET_MS = 450;
const PERF_DONE_BUDGET_MS = 300;

test('a large photo opens and is done within the budget (perf)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openForZbyhoslav(page);
    const png = await quartersPng(page, 4000, 3000);
    const calibrate = () => page.evaluate(([fn, rounds]) => {
        const w = window as unknown as { __calibration?: (r: number) => number };
        w.__calibration ??= new Function(`return (${fn})`)() as (r: number) => number;
        const t = performance.now();
        w.__calibration(rounds);
        return performance.now() - t;
    }, [calibrationWorkload.toString(), PERF_CALIBRATION_ROUNDS] as const);
    const best = { open: Infinity, done: Infinity };
    const log: string[] = [];
    for (let round = 0; round < 3; round++) {
        const cal = await calibrate();
        const t0 = Date.now();
        await personModal(page).locator('#input-photo').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png });
        await expect(editor(page).locator('.pe-frame')).toBeFocused();
        // Drawn: the preview's canvas has the photo.
        await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
        const open = Date.now() - t0;
        await page.keyboard.press('+');
        const t1 = Date.now();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        const done = Date.now() - t1;
        best.open = Math.min(best.open, normalizedMs(open, cal, PERF_CALIBRATION_REFERENCE_MS));
        best.done = Math.min(best.done, normalizedMs(done, cal, PERF_CALIBRATION_REFERENCE_MS));
        log.push(`open ${open} done ${done} (×${machineFactor(cal, PERF_CALIBRATION_REFERENCE_MS).toFixed(2)})`);
    }
    console.log(`[portrait-editor perf] ${log.join(' / ')}; best normalized open ${best.open.toFixed(0)}, done ${best.done.toFixed(0)} ms`);
    expect(best.open).toBeLessThan(PERF_OPEN_BUDGET_MS);
    expect(best.done).toBeLessThan(PERF_DONE_BUDGET_MS);
    // Save with the original: the attachment is there.
    const t2 = Date.now();
    await personModal(page).getByRole('button', { name: 'Save' }).click();
    await expect(personModal(page)).toBeHidden();
    console.log(`[portrait-editor perf] save ${Date.now() - t2} ms`);
    expect((await stored(page)).attachments).toHaveLength(1);
});
