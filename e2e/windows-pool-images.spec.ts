import { test, expect, Page, BrowserContext } from '@playwright/test';
import { openApp, reloadApp, seedTree } from './helpers.js';

/**
 * The satellite windows and the tree's pooled images (spec 135, D8): the
 * tree goes to a satellite with its images as the pool references it holds
 * (small), and the satellite shows them read by the main window — an
 * encrypted pool's too, as the key stays there: through `opener`, or asked
 * over the windows' channel by a window that does not reach it (opened on
 * its own, a second tab turned into a window), which reads nothing itself.
 * An edit made in a satellite keeps every image, a new one there goes into
 * the pool once; a satellite tells the main window's pool cleanup what it
 * holds while open. Invented people, drawn pictures.
 */

const PEOPLE = {
    kasimir: { firstName: 'Kasimir', lastName: 'Zwirnhofer', gender: 'male', birthDate: '1871', partners: ['walpurga'] },
    walpurga: { firstName: 'Walpurga', lastName: 'Zwirnhoferová', gender: 'female', birthDate: '1874' },
    leopoldine: { firstName: 'Leopoldine', lastName: 'Zwirnhoferová', gender: 'female', birthDate: '1899', parents: ['kasimir', 'walpurga'] },
} as const;

/** A drawn picture as a data URL, different for each seed and large enough for the pool (≥ 1 kB). */
function drawn(page: Page, seed: number, w = 120, h = 90): Promise<string> {
    return page.evaluate(({ seed, w, h }) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d')!;
        let r = seed * 2654435761 >>> 0;
        for (let i = 0; i < 400; i++) {
            r = (r * 1103515245 + 12345) >>> 0;
            x.fillStyle = `hsl(${r % 360} 60% ${30 + (r >>> 9) % 40}%)`;
            x.fillRect((r >>> 3) % w, (r >>> 11) % h, 6 + (r >>> 17) % 14, 6 + (r >>> 21) % 14);
        }
        return c.toDataURL('image/png');
    }, { seed, w, h });
}

const photoOf = (p: Page, id: string) => p.evaluate((pid) => window.Strom.DataManager.getData().persons[pid as never]?.photo ?? '', id);

/** The tree stored with portraits and an attachment, read again: its images are pool references in memory. */
async function storedWithImages(page: Page): Promise<{ photos: Record<string, string>; scan: string }> {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page);
    const photos = { kasimir: await drawn(page, 1), walpurga: await drawn(page, 2), leopoldine: await drawn(page, 3) };
    const scan = await drawn(page, 5, 300, 200);
    const people = Object.fromEntries(Object.entries(PEOPLE).map(([id, p]) => [id, { ...p, photo: photos[id as keyof typeof photos] }]));
    await seedTree(page, people as never, 'Zwirnhofer', 'leopoldine');
    await page.evaluate(async (dataUrl) => {
        window.Strom.DataManager.addAttachment('kasimir' as never, { name: 'zwirnhof-brief.png', mimeType: 'image/png', dataUrl, sizeBytes: 5000 });
        await window.Strom.TreeManager.flush();
    }, scan);
    await reloadApp(page);
    await expect.poll(() => photoOf(page, 'walpurga')).toMatch(/^\u0000sm:p:[0-9a-f]{40}$/);
    return { photos, scan };
}

/** A satellite the main window opens (its opener is the main window). */
async function openFromMain(page: Page, kind: string): Promise<{ sat: Page; id: string }> {
    const [sat, id] = await Promise.all([
        page.waitForEvent('popup'),
        page.evaluate((k) => window.Strom.Windows!.openSatellite(k as never)!, kind),
    ]);
    await sat.setViewportSize({ width: 1200, height: 800 });
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Zwirnhofer');
    return { sat, id };
}

/** A satellite opened on its own (no opener: as a second tab turned into a window). */
async function openAlone(context: BrowserContext, treeId: string, kind: string, w: string): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.goto(`/strom.html?okno=${kind}&tree=${encodeURIComponent(treeId)}&w=${w}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Zwirnhofer');
    return sat;
}

/** An <img> shows its picture (decoded, of real size); its address. */
async function expectShown(p: Page, selector: string, scheme: RegExp = /^blob:/): Promise<string> {
    const shown = () => p.evaluate((sel) => {
        const img = document.querySelector<HTMLImageElement>(sel);
        return img ? { src: img.getAttribute('src') ?? '', w: img.complete ? img.naturalWidth : 0 } : null;
    }, selector);
    await expect.poll(async () => {
        const s = await shown();
        return !!s && scheme.test(s.src) && s.w > 0;
    }, { message: selector }).toBe(true);
    return (await shown())!.src;
}

const card = (id: string) => `.person-card[data-id="${id}"] .card-avatar img`;

test.describe('Satellite windows and pooled images (desktop)', () => {
    test('a satellite shows the pooled portraits and materials through the main window; its tree holds the references; closed, it holds nothing', async ({ page }) => {
        test.setTimeout(60_000);
        await storedWithImages(page);
        const { sat, id } = await openFromMain(page, 'family');
        // The copy holds the references as the main window does (no image whole in it).
        expect(await photoOf(sat, 'walpurga')).toBe(await photoOf(page, 'walpurga'));
        expect(await sat.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()).includes('data:image'))).toBe(false);
        for (const who of ['kasimir', 'walpurga', 'leopoldine']) await expectShown(sat, card(who));

        // A material: the person's attachment in the satellite's edit dialog.
        await sat.evaluate(() => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal('kasimir');
        });
        const thumb = '#person-modal #attachments-list .attachment-row img';
        await sat.locator(thumb).first().scrollIntoViewIfNeeded();
        await expectShown(sat, thumb);
        await sat.keyboard.press('Escape');

        // The main window's pool cleanup knows what the satellite holds, and that it holds nothing once closed.
        await expect.poll(() => page.evaluate(() => window.Strom.Images.satellitesHolding())).toContain(id);
        await sat.close();
        await expect.poll(() => page.evaluate(() => window.Strom.Images.satellitesHolding())).not.toContain(id);
    });

    test('an edit in a satellite keeps every image; a new photo there goes into the pool once and comes back as its reference', async ({ page }) => {
        test.setTimeout(60_000);
        const { photos } = await storedWithImages(page);
        const before = { kasimir: await photoOf(page, 'kasimir'), walpurga: await photoOf(page, 'walpurga') };
        const { sat } = await openFromMain(page, 'family');
        const fresh = await drawn(sat, 9, 160, 120);
        await sat.evaluate((photo) => {
            window.Strom.DataManager.updatePerson('leopoldine' as never, { firstName: 'Leopoldina', photo } as never);
        }, fresh);
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getData().persons['leopoldine' as never].firstName)).toBe('Leopoldina');
        // Stored: the new photo as its reference, here and in the satellite; the others as they were.
        await expect.poll(() => photoOf(page, 'leopoldine')).toMatch(/^\u0000sm:p:[0-9a-f]{40}$/);
        await expect.poll(() => photoOf(sat, 'leopoldine')).toBe(await photoOf(page, 'leopoldine'));
        expect({ kasimir: await photoOf(page, 'kasimir'), walpurga: await photoOf(page, 'walpurga') }).toEqual(before);
        await expectShown(sat, card('leopoldine'));
        // The pool holds the new picture once, and every picture reads back as it was put in.
        const pooled = await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((ok, fail) => { const r = indexedDB.open('strom-db'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
            const keys = await new Promise<IDBValidKey[]>((ok, fail) => { const r = db.transaction('media').objectStore('media').getAllKeys(); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
            db.close();
            return keys.map(String).filter(k => /^p:/.test(k));
        });
        const freshId = (await photoOf(page, 'leopoldine')).slice(4);
        expect(pooled.filter(k => k === freshId)).toHaveLength(1);
        await sat.close();
        await reloadApp(page);
        const whole = await page.evaluate(async () => {
            const persons = await window.Strom.Images.expandedData(window.Strom.DataManager.getData().persons);
            return Object.fromEntries(Object.entries(persons).map(([id, p]) => [id, (p as { photo?: string }).photo ?? '']));
        });
        expect(whole).toEqual({ kasimir: photos.kasimir, walpurga: photos.walpurga, leopoldine: fresh });
    });

    test('an encrypted pool: the references, read and decrypted by the main window, also for a window that does not reach it', async ({ page, context }) => {
        test.setTimeout(90_000);
        await storedWithImages(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        await settings.locator('#encryption-toggle').check();
        const setup = page.locator('#password-setup-modal');
        await setup.locator('#password-setup-input').fill('zwirn-hof-1871');
        await setup.locator('#password-setup-confirm').fill('zwirn-hof-1871');
        await setup.getByRole('button', { name: 'Save' }).click();
        await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
        await page.keyboard.press('Escape');
        await expect.poll(() => photoOf(page, 'walpurga'), { timeout: 20_000 }).toMatch(/^\u0000sm:e:[0-9a-f]{40}$/);

        const { sat } = await openFromMain(page, 'family');
        expect(await photoOf(sat, 'walpurga')).toBe(await photoOf(page, 'walpurga'));
        for (const who of ['kasimir', 'walpurga', 'leopoldine']) await expectShown(sat, card(who));

        // A window the main window did not open: it holds no key; it asks the main window over the channel.
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        const alone = await openAlone(context, treeId, 'family', 'zw01aa');
        expect(await photoOf(alone, 'walpurga')).toBe(await photoOf(page, 'walpurga'));
        for (const who of ['kasimir', 'walpurga', 'leopoldine']) await expectShown(alone, card(who));
    });

    test('a window that does not reach the main window asks it for the images; it opens no storage', async ({ page, context }) => {
        test.setTimeout(60_000);
        await storedWithImages(page);
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        const alone = await context.newPage();
        await alone.addInitScript(() => {
            const w = window as unknown as { __opened: string[] };
            w.__opened = [];
            const open = indexedDB.open.bind(indexedDB);
            indexedDB.open = (n: string, v?: number) => { w.__opened.push(n); return open(n, v); };
        });
        await alone.setViewportSize({ width: 1200, height: 800 });
        await alone.goto(`/strom.html?okno=family&tree=${encodeURIComponent(treeId)}&w=zw02aa`);
        await expect(alone.locator('.sat-header-title')).toHaveText('Zwirnhofer');
        expect(await photoOf(alone, 'walpurga')).toBe(await photoOf(page, 'walpurga'));
        for (const who of ['kasimir', 'walpurga', 'leopoldine']) await expectShown(alone, card(who));
        expect(await alone.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);
    });
});
