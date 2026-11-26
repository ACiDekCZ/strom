import { test, expect, Page, Locator, Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { openApp, card, cardAction } from './helpers.js';

/**
 * Give a family tree… → Create package (spec 093 §5, §8): the package made
 * for Daniel Berg of the sample tree is a ZIP with one folder holding the
 * cover page ("Start here.html"), the app with the cut's data opening on
 * Daniel, the family pages, the book, the ancestor fan and the GEDCOM. A
 * hidden detail of a living person outside the household (Eva Berg's e-mail
 * and address, fictional, added for the test) is in none of its files.
 * On a computer the file downloads at once; on a phone through "Save to
 * Files". Cancelling while it is made says "Cancelled" and downloads nothing.
 */

const TODAY = new Date('2026-12-10T10:00:00');
const EMAIL = 'eva.test@example.invalid';
const ADDRESS = 'Fjordveien 12';

/** The entries of a ZIP (stored or deflated), by path. */
function readZip(buf: Buffer): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('not a ZIP');
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(at + 10);
        const csize = buf.readUInt32LE(at + 20);
        const nameLen = buf.readUInt16LE(at + 28);
        const extraLen = buf.readUInt16LE(at + 30);
        const commentLen = buf.readUInt16LE(at + 32);
        const local = buf.readUInt32LE(at + 42);
        const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
        const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(dataAt, dataAt + csize);
        out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
        at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

async function sampleOnDaniel(page: Page): Promise<void> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async ({ email, address }) => {
        await window.Strom.UI.loadDemoTree();
        // A living person outside Daniel's household with a contact and an address (fictional).
        const eva = window.Strom.DataManager.getData().persons['demo_eva' as never] as unknown as Record<string, unknown>;
        eva.emails = [email];
        eva.birthAddress = address;
        eva.events = [...((eva.events as unknown[]) ?? []), { id: 'ev_gift_test', type: 'residence', place: 'Bergen', address }];
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    }, { email: EMAIL, address: ADDRESS });
    await expect(card(page, 'Daniel')).toBeVisible();
}

/** The guide from Daniel's person menu, straight to step 6. */
async function openOnReview(page: Page): Promise<Locator> {
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    // A phone has no side tabs: step 1's "Straight to preview".
    const phone = (page.viewportSize()?.width ?? 1440) <= 640;
    await dialog.locator(phone ? '[data-gk="fast-phone"]' : '#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('.gift-review')).toBeVisible();
    return dialog;
}

/** Everything the package holds, checked; returns the entries' paths. */
function checkPackage(download: Download, buf: Buffer): string[] {
    expect(download.suggestedFilename()).toBe('Family tree – Daniel Berg – 2026.zip');
    const zip = readZip(buf);
    const paths = [...zip.keys()];
    const folder = 'Family tree – Daniel Berg/';
    expect(paths.every(p => p.startsWith(folder))).toBe(true);
    const at = (p: string): Buffer => {
        const b = zip.get(folder + p);
        expect(b, p).toBeTruthy();
        return b!;
    };
    // The cover page names the recipient and leads to the parts.
    const cover = at('Start here.html').toString('utf8');
    expect(cover).toContain('Daniel');
    expect(cover).toContain('Family%20pages/index.html');
    // The app: the cut's data, opening on Daniel.
    const app = at('Family tree (app).html').toString('utf8');
    const m = /window\.STROM_EMBEDDED_DATA = (\{[\s\S]*?\});<\/script>/.exec(app);
    expect(m).toBeTruthy();
    const envelope = JSON.parse(m![1]) as { data: { defaultPersonId?: string; persons: Record<string, unknown> }; view?: unknown };
    expect(envelope.data.defaultPersonId).toBe('demo_daniel');
    // The card detail chosen in step 4 (K5.7), Detailed by default.
    expect(envelope.view).toEqual({ cardDensity: 'detailed' });
    expect(envelope.data.persons.demo_daniel).toBeTruthy();
    expect(at('Family pages/index.html').toString('utf8')).toContain('Daniel');
    expect(at('Family book.html').toString('utf8')).toContain('Berg');
    expect(at('Ancestor fan.svg').toString('utf8')).toContain('<svg');
    expect(at('For other programs/Family tree.ged').toString('utf8')).toContain('0 HEAD');
    // No hidden detail of the living anywhere in the package.
    for (const [path, b] of zip) {
        const text = b.toString('utf8');
        expect(text.includes(EMAIL), `${path} holds the e-mail`).toBe(false);
        expect(text.includes(ADDRESS), `${path} holds the address`).toBe(false);
    }
    return paths;
}

test('a computer: Create package makes the ZIP with every part, downloads it, and no hidden detail of the living leaks', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    const dialog = await openOnReview(page);

    // Step 6: the numbers, the rows with "Change", the archive's name, the cover page.
    await expect(dialog.locator('#gift-sub')).toHaveText('step 6 of 6: Preview and create');
    await expect(dialog.locator('.gift-review-stats .structure-stat')).toHaveCount(4);
    await expect(dialog.locator('.gift-review-dl .gift-change')).toHaveCount(5);
    await expect(dialog.locator('[data-gk="file-name"]')).toHaveValue('Family tree – Daniel Berg – 2026.zip');
    await expect(dialog.locator('.gift-thumb iframe')).toHaveCount(1);
    await expect(dialog.locator('#gift-next')).toHaveText('Create package');

    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('#gift-next').click();
    await expect(dialog.locator('.gift-run')).toBeVisible();
    const download = await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"] .gift-run-h')).toHaveText('The package is ready', { timeout: 60_000 });
    await expect(dialog.locator('.gift-done-name')).toHaveText('Family tree – Daniel Berg – 2026.zip');
    await expect(dialog.locator('.gift-run .gift-note').last()).toContainText('The settings were saved for Daniel Berg');
    await expect(dialog.locator('[data-gk="run-finish"]')).toHaveText('Done');
    await expect(dialog.locator('#gift-next')).toBeHidden();

    const paths = checkPackage(download, readFileSync((await download.path())!));
    expect(paths.some(p => p.endsWith('Ancestor fan.png'))).toBe(true);

    // The cover page in its own window; Escape closes it, the guide stays.
    await dialog.locator('[data-gk="open-cover"]').click();
    await expect(page.locator('#gift-cover-modal iframe')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#gift-cover-modal')).toHaveCount(0);
    await expect(dialog).toHaveClass(/active/);

    // Done closes the guide; the person menu now carries the day it was made.
    await dialog.locator('[data-gk="run-finish"]').click();
    await expect(dialog).not.toHaveClass(/active/);
});

test('a phone: the package is saved through "Save to Files"', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await sampleOnDaniel(page);
    const dialog = await openOnReview(page);
    let early = false;
    page.on('download', () => { early = true; });
    await dialog.locator('#gift-next').click();
    await expect(dialog.locator('.gift-run[data-phase="done"]')).toBeVisible({ timeout: 60_000 });
    // A phone does not download by itself.
    expect(early).toBe(false);
    const save = dialog.locator('[data-gk="run-save"]');
    await expect(save).toHaveText('Save to Files');
    const downloaded = page.waitForEvent('download');
    await save.click();
    const download = await downloaded;
    checkPackage(download, readFileSync((await download.path())!));
    const box = await dialog.locator('.modal').boundingBox();
    expect(box?.width).toBe(390);
});

test('cancelling while the package is made says Cancelled and downloads nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    // The app's file waits until released: the making stays in its second step.
    await page.evaluate(() => {
        const w = window as unknown as { __giftRelease?: () => void };
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: () => Promise<Blob> };
        exporter.buildFocusAppBlob = () => new Promise<Blob>(resolve => { w.__giftRelease = () => resolve(new Blob(['app'])); });
    });
    const dialog = await openOnReview(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await dialog.locator('#gift-next').click();
    const run = dialog.locator('.gift-run[data-phase="making"]');
    await expect(run.locator('.prog-k')).toHaveText('step 2 of 7');
    await expect(run.locator('.gift-stp.is-done')).toHaveCount(1);
    await expect(run.locator('.gift-stp.is-now')).toContainText('App with the family tree');
    await expect(dialog.locator('#gift-nav [data-step="1"]')).toHaveAttribute('aria-disabled', 'true');
    await dialog.locator('[data-gk="run-cancel"]').click();
    await page.evaluate(() => (window as unknown as { __giftRelease?: () => void }).__giftRelease?.());
    await expect(dialog.locator('.gift-run[data-phase="cancelled"] .gift-run-h')).toHaveText('Cancelled');
    await expect(dialog.locator('[data-gk="run-again"]')).toHaveText('Create again');
    expect(downloads).toBe(0);
    // A side tab leads back to the steps.
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('.gift-review')).toBeVisible();
    await expect(dialog.locator('#gift-next')).toBeVisible();
});

test('step 4: the parts with their sizes, photos, the ZIP as a tree; Book settings… comes back to the step', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await expect(dialog.locator('#gift-sub')).toHaveText('step 4 of 6: What the package holds');

    const rows = dialog.locator('.gift-pt-r');
    await expect(rows).toHaveCount(6);
    await expect(dialog.locator('[data-part="cover"]')).toBeDisabled();
    await expect(rows.first()).toContainText('Cover letter – Start here');
    await expect(dialog.locator('.gift-zip-r').first()).toHaveText(/Family tree – Daniel Berg – 2026\.zip/);
    await expect(dialog.locator('.gift-zip-r.is-off')).toHaveCount(0);
    const total = await dialog.locator('.gift-zip-tot b').textContent();

    // GEDCOM off: its rows struck out in the ZIP, the total smaller.
    await dialog.locator('[data-part="gedcom"]').uncheck();
    await expect(dialog.locator('.gift-zip-r.is-off')).toHaveCount(2);
    await expect(dialog.locator('.gift-pt-r.is-off')).toContainText('GEDCOM');
    await expect(dialog.locator('.gift-zip-tot b')).not.toHaveText(total!);

    // Photos: a segment of two.
    await expect(dialog.locator('[data-gk="photos-on"]')).toHaveAttribute('aria-checked', 'true');
    await dialog.locator('[data-gk="photos-off"]').click();
    await expect(dialog.locator('[data-gk="photos-off"]')).toHaveAttribute('aria-checked', 'true');

    // The fan (K5.6): Antique with photos, the plain stem; a second style, a file pair of its own each.
    await expect(dialog.locator('[data-gk="fan-mode-styles"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-gk="fan-style-antique"]')).toBeChecked();
    await expect(dialog.locator('[data-gk="fan-style-antique"]')).toBeDisabled();
    // Photos off above: the fan's photos off and fixed; photos back, the fan's back too.
    await expect(dialog.locator('[data-gk="fan-photos"]')).not.toBeChecked();
    await expect(dialog.locator('[data-gk="fan-photos"]')).toBeDisabled();
    await dialog.locator('[data-gk="photos-on"]').click();
    await expect(dialog.locator('[data-gk="fan-photos"]')).toBeChecked();
    await expect(dialog.locator('[data-gk="fan-photos"]')).toBeEnabled();
    const zipRows = dialog.locator('.gift-zip-r');
    await expect(zipRows.filter({ hasText: 'Ancestor fan.svg' })).toHaveCount(1);
    const count = await zipRows.count();
    await dialog.locator('[data-gk="fan-style-color"]').check();
    await expect(zipRows).toHaveCount(count + 2);
    await expect(zipRows.filter({ hasText: 'Ancestor fan – Colour.svg' })).toHaveCount(1);
    await expect(zipRows.filter({ hasText: 'Ancestor fan – Antique.png' })).toHaveCount(1);
    // Every fan file has its own size, not only the last one (093 U6 N2).
    const fanSizes = await zipRows.filter({ hasText: 'Ancestor fan' }).locator('.gift-zip-s').allTextContents();
    expect(fanSizes).toHaveLength(4);
    for (const s of fanSizes) expect(s.trim()).not.toBe('');
    await expect(dialog.locator('[data-gk="fan-style-antique"]')).toBeEnabled();
    // As in the tree: one fan, the look's link back.
    await dialog.locator('[data-gk="fan-mode-tree"]').click();
    await expect(zipRows).toHaveCount(count);
    await expect(dialog.locator('[data-gk="fan-style-color"]')).toHaveCount(0);
    await dialog.locator('[data-gk="fan-mode-styles"]').click();
    await expect(dialog.locator('[data-gk="fan-style-color"]')).toBeChecked();

    // Card detail of the app in the package (K5.7): Detailed by default.
    await expect(dialog.locator('[data-gk="cards"]')).toHaveValue('detailed');
    await dialog.locator('[data-gk="cards"]').selectOption('register');

    // Nothing overflows sideways.
    const wide = await dialog.locator('.modal').evaluate(m => [m, ...m.querySelectorAll('.gift-pane, .gift-pt-sub, .gift-pt-r')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
    expect(wide).toEqual([]);

    // Book settings…: the book's dialog over the app; closed, the guide is back at step 4.
    await dialog.locator('[data-gk="part-link-book"]').click();
    await expect(page.locator('#book-modal')).toHaveClass(/active/);
    await expect(dialog).not.toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#book-modal')).not.toHaveClass(/active/);
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog.locator('#gift-sub')).toHaveText('step 4 of 6: What the package holds');
    await expect(dialog.locator('[data-part="gedcom"]')).not.toBeChecked();
    await expect(dialog.locator('[data-gk="fan-style-color"]')).toBeChecked();
    await expect(dialog.locator('[data-gk="cards"]')).toHaveValue('register');
});

test('step 4 on a phone upright and sideways, a tablet, in German, light and dark: the fan\'s and the cards\' rows fit', async ({ page }) => {
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    for (const [w, h] of [[390, 844], [844, 390], [1024, 768]] as const) {
        for (const theme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width: w, height: h });
            await page.evaluate(t => window.Strom.SettingsManager.setTheme(t), theme);
            await page.evaluate(() => window.Strom.UI.showGiftTree({ personId: 'demo_daniel' as never }));
            const dialog = page.locator('#gift-modal');
            await expect(dialog).toHaveClass(/active/);
            const nav = dialog.locator('#gift-nav');
            if (await nav.isVisible()) await nav.locator('[data-step="4"]').click();
            else {
                await dialog.locator('#gift-sub-btn').click();
                await page.locator('.gift-steps-sheet #gift-sheet-step-4').click();
            }
            const where = `${w}×${h} ${theme}`;
            await expect(dialog.locator('[data-gk="fan-style-mono"]'), where).toBeVisible();
            await expect(dialog.locator('[data-gk="cards"]'), where).toBeVisible();
            const wide = await dialog.locator('.modal').evaluate(m => [m, ...m.querySelectorAll('.gift-pane, .gift-pt-sub, .gift-pt-r, .gift-seg')]
                .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
            expect(wide, where).toEqual([]);
            await dialog.locator('.modal-header .close-btn').click();
            await expect(dialog).not.toHaveClass(/active/);
        }
    }
});

test('step 5: the template by language and motif, an own message in the live preview, the template inserted again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await dialog.locator('#gift-nav [data-step="5"]').click();
    await expect(dialog.locator('#gift-sub')).toHaveText('step 5 of 6: Cover letter');

    const message = dialog.locator('[data-gk="letter-message"]');
    const template = await message.inputValue();
    expect(template.length).toBeGreaterThan(40);
    await expect(dialog.locator('[data-gk="letter-reinsert"]')).toBeHidden();
    await expect(dialog.locator('.gift-numbers')).toContainText('From the family tree, not the whole tree:');

    // The motif changes the template.
    await dialog.locator('[data-gk="motif-xmas"]').click();
    await expect(dialog.locator('[data-gk="motif-xmas"]')).toHaveAttribute('aria-checked', 'true');
    await expect(message).not.toHaveValue(template);

    // An own message: in the preview a moment later; "Insert the template again" brings the template back.
    await message.fill('A short note for the family archive.');
    await expect(dialog.locator('[data-gk="letter-reinsert"]')).toBeVisible();
    await expect.poll(() => dialog.locator('.gift-thumb-frame').getAttribute('srcdoc')).toContain('A short note for the family archive.');
    await dialog.locator('[data-gk="letter-reinsert"]').click();
    await expect(message).not.toHaveValue('A short note for the family archive.');
    await expect(dialog.locator('[data-gk="letter-reinsert"]')).toBeHidden();

    // The letter's language: the template in German, the file names too.
    await dialog.locator('[data-gk="letter-lang"]').selectOption('de');
    await expect(message).toHaveValue(/[äöüß]|Familie|Weihnacht/);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('[data-gk="file-name"]')).toHaveValue('Stammbaum – Daniel Berg – 2026.zip');
});
