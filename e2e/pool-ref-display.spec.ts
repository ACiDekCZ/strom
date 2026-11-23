import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openApp, seedTree, card } from './helpers.js';

/**
 * The tree's images shown from the image pool (spec 135): with a pooled
 * image's reference (`\u0000sm:<id>`) in place of the data URL in the tree
 * in memory, every place that shows it puts the picture in from the pool —
 * an object URL of its bytes, while on screen — and lets it go off screen or
 * when the place closes. Part D3: the cards and their tooltips, the
 * relationships panel's couple's photo and its viewer, the table's Photo
 * column and the fan's portraits. Part D4: the materials (the person's
 * attachments, the materials window, its viewer and Download), a source's
 * excerpt (a research crop turned by its orientation) and the portrait
 * editor fed from a pooled photo. Further places add their own test here.
 *
 * The tree is stored with data URLs (the pool then holds its images), then
 * its photos are replaced in memory by their references, as a tree read
 * from storage will hold them. Invented people, drawn pictures.
 */

const PEOPLE = {
    kasimir: { firstName: 'Kasimir', lastName: 'Zwirnhofer', gender: 'male', birthDate: '1871', partners: ['walpurga'] },
    walpurga: { firstName: 'Walpurga', lastName: 'Zwirnhoferová', gender: 'female', birthDate: '1874' },
    leopoldine: { firstName: 'Leopoldine', lastName: 'Zwirnhoferová', gender: 'female', birthDate: '1899', parents: ['kasimir', 'walpurga'] },
} as const;
const UNION = 'u_kasimir_walpurga';

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

/**
 * The tree stored with its photos (the pool holds them), then the photos
 * in memory replaced by their references. Returns person/union id → ref.
 */
async function treeWithRefs(page: Page): Promise<Record<string, string>> {
    await openApp(page);
    const photos = {
        kasimir: await drawn(page, 1),
        walpurga: await drawn(page, 2),
        leopoldine: await drawn(page, 3),
        [UNION]: await drawn(page, 4, 240, 160),
    };
    const people = Object.fromEntries(Object.entries(PEOPLE).map(([id, p]) => [id, { ...p, photo: photos[id as keyof typeof photos] }]));
    await seedTree(page, people as never, 'Zwirnhofer', 'leopoldine');
    return page.evaluate(async ({ photos, union }) => {
        const S = window.Strom;
        S.DataManager.updatePartnership(union, { photo: photos[union] });
        await S.TreeManager.flush();
        const refOf = async (url: string): Promise<string> => {
            const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)));
            return '\u0000sm:p:' + [...d.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join('');
        };
        // Every image is in the pool now.
        const db = await new Promise<IDBDatabase>((ok, fail) => {
            const r = indexedDB.open('strom-db');
            r.onsuccess = () => ok(r.result);
            r.onerror = () => fail(r.error);
        });
        const keys = await new Promise<IDBValidKey[]>((ok, fail) => {
            const r = db.transaction('media').objectStore('media').getAllKeys();
            r.onsuccess = () => ok(r.result);
            r.onerror = () => fail(r.error);
        });
        db.close();
        const refs: Record<string, string> = {};
        for (const [id, url] of Object.entries(photos)) {
            refs[id] = await refOf(url);
            if (!keys.includes(refs[id].slice(4))) throw new Error(`not pooled: ${id}`);
        }
        // In memory as a tree read from storage will hold them (no save: the stored tree stays as it is).
        const data = S.DataManager.getData();
        for (const id of Object.keys(photos)) {
            if (id === union) data.partnerships[id].photo = refs[id];
            else data.persons[id].photo = refs[id];
        }
        S.TreeRenderer.render();
        return refs;
    }, { photos, union: UNION });
}

/**
 * Every data URL the pool holds (≥ 1 kB) replaced in the tree in memory by
 * its reference, after the tree is stored. Returns data URL → ref.
 */
async function poolInMemory(page: Page): Promise<Record<string, string>> {
    return page.evaluate(async () => {
        const S = window.Strom;
        await S.TreeManager.flush();
        const refs: Record<string, string> = {};
        const refOf = async (url: string): Promise<string> => {
            const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)));
            return '\u0000sm:p:' + [...d.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join('');
        };
        const walk = async (o: unknown): Promise<void> => {
            if (!o || typeof o !== 'object') return;
            const rec = o as Record<string, unknown>;
            for (const k of Object.keys(rec)) {
                const v = rec[k];
                if (typeof v === 'string' && v.startsWith('data:') && v.length >= 1024) {
                    refs[v] ??= await refOf(v);
                    rec[k] = refs[v];
                } else await walk(v);
            }
        };
        await walk(S.DataManager.getData());
        S.TreeRenderer.render();
        return refs;
    });
}

const idOf = (ref: string) => ref.slice(4);

/** An <img> shows its picture: a blob: object URL, decoded, of real size. */
function shown(page: Page, selector: string): Promise<{ src: string; w: number } | null> {
    return page.evaluate((sel) => {
        const img = document.querySelector<HTMLImageElement>(sel);
        if (!img) return null;
        return { src: img.getAttribute('src') ?? '', w: img.complete ? img.naturalWidth : 0 };
    }, selector);
}

async function expectShown(page: Page, selector: string): Promise<string> {
    await expect.poll(async () => {
        const s = await shown(page, selector);
        return !!s && s.src.startsWith('blob:') && s.w > 0;
    }, { message: selector }).toBe(true);
    return (await shown(page, selector))!.src;
}

/** Whether an object URL still gives its bytes (a revoked one does not). */
function alive(page: Page, url: string): Promise<boolean> {
    return page.evaluate(async (u) => {
        try { return (await fetch(u)).ok; } catch { return false; }
    }, url);
}

test.describe('Images from the pool (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the cards and their tooltips show the pooled portraits, and let them go off screen', async ({ page }) => {
        const refs = await treeWithRefs(page);
        const urls: Record<string, string> = {};
        for (const id of ['kasimir', 'walpurga', 'leopoldine']) {
            const avatar = `.person-card[data-id="${id}"] .card-avatar img`;
            await expect(page.locator(avatar)).toHaveAttribute('data-pool-ref', idOf(refs[id]));
            urls[id] = await expectShown(page, avatar);
            // The tooltip shows the same picture, ready before it is hovered.
            const tip = `.person-card[data-id="${id}"] .card-tooltip img.tt-photo`;
            await expect(page.locator(tip)).toHaveAttribute('data-pool-ref', idOf(refs[id]));
            await expect.poll(() => shown(page, tip).then(s => s?.src)).toBe(urls[id]);
        }
        await card(page, 'Leopoldine').hover();
        await expectShown(page, '.person-card[data-id="leopoldine"] .card-tooltip img.tt-photo');

        // The cache bound at one image: all three stay while on screen …
        await page.evaluate(() => window.Strom.Images.setImageCacheLimits(64 * 1024 * 1024, 1));
        for (const id of Object.keys(urls)) expect(await alive(page, urls[id]), id).toBe(true);
        // … scrolled away, they go: the URLs revoked, the cards back to the placeholder.
        await page.mouse.move(0, 0);
        await page.evaluate(() => window.Strom.ZoomPan.shiftWorld(20000, 0));
        await expect.poll(() => page.evaluate(() => window.Strom.Images.imageCacheStats().count)).toBeLessThanOrEqual(1);
        let revoked = 0;
        for (const id of Object.keys(urls)) if (!(await alive(page, urls[id]))) revoked++;
        expect(revoked).toBeGreaterThanOrEqual(2);
        await expect.poll(() => page.locator('.person-card .card-avatar img[src^="data:image/gif"]').count()).toBeGreaterThanOrEqual(2);
        // Back on screen: read anew.
        await page.evaluate(() => window.Strom.ZoomPan.shiftWorld(-20000, 0));
        for (const id of Object.keys(urls)) await expectShown(page, `.person-card[data-id="${id}"] .card-avatar img`);
    });

    test('the relationships panel shows the couple\'s pooled photo; its viewer shows it and lets it go when closed', async ({ page }) => {
        const refs = await treeWithRefs(page);
        await page.evaluate(() => window.Strom.UI.showRelationshipsPanel('kasimir' as never));
        const row = page.locator(`#relationships-modal .pg-photo[data-partnership-id="${UNION}"]`);
        await expect(row.locator('.pg-photo-thumb img')).toHaveAttribute('data-pool-ref', idOf(refs[UNION]));
        await expectShown(page, `#relationships-modal .pg-photo[data-partnership-id="${UNION}"] .pg-photo-thumb img`);
        // Its size from the image catalog, as for the data URL.
        await expect(row.locator('.pg-photo-size')).toHaveText(/^\d+ kB$/);

        await row.locator('.pg-photo-thumb').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        const src = await expectShown(page, '#attachment-overlay-img');
        expect(await page.locator('#attachment-overlay-img').evaluate(i => (i as HTMLImageElement).naturalWidth)).toBe(240);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        expect(await alive(page, src)).toBe(false);
    });

    test('the table\'s Photo column shows the couple\'s pooled photo', async ({ page }) => {
        const refs = await treeWithRefs(page);
        await page.locator('#view-mode-table').click();
        const tv = page.locator('#table-container');
        await tv.locator('.tv-rowtype [data-rowtype="unions"]').click();
        await expect(tv).toHaveAttribute('data-rowtype', 'unions');
        await tv.locator('.tv-cols-btn').click();
        const cols = page.locator('.tv-colpanel');
        await page.locator('.tv-cp-q').fill('Photo');
        await cols.getByRole('checkbox', { name: 'Photo', exact: true }).check();
        await cols.locator('.tv-cp-done').click();
        const thumb = `#table-container .tv-row[data-key="u:${UNION}"] .tv-thumb img`;
        await expect(page.locator(thumb)).toHaveAttribute('data-pool-ref', idOf(refs[UNION]));
        // The Photo column, added last, is beyond the table's right edge: put in once scrolled to.
        await page.locator(thumb).scrollIntoViewIfNeeded();
        await expectShown(page, thumb);
        // Zoomed: the viewer shows it as well.
        await page.locator(thumb).click();
        await expectShown(page, '#attachment-overlay-img');
    });

    test('the fan\'s portraits show the pooled photos; the cards\' images go once the tree view is left', async ({ page }) => {
        const refs = await treeWithRefs(page);
        const cardUrl = await expectShown(page, '.person-card[data-id="walpurga"] .card-avatar img');
        await page.evaluate(() => window.Strom.Images.setImageCacheLimits(64 * 1024 * 1024, 1));
        await page.evaluate(() => {
            window.Strom.TreeRenderer.setFanPortraits(true);
            window.Strom.UI.setDisplayViewMode('fan');
        });
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        const images = page.locator('#fan-chart image[data-pool-ref]');
        await expect(images).toHaveCount(3);
        expect((await images.evaluateAll(els => els.map(e => e.getAttribute('data-pool-ref')))).sort())
            .toEqual(['kasimir', 'walpurga', 'leopoldine'].map(id => idOf(refs[id])).sort());
        // Each portrait's address gives its picture (a PNG, drawn: the SVG image has no natural size to ask).
        await expect.poll(() => images.evaluateAll(els => els.every(e => (e.getAttribute('href') ?? '').startsWith('blob:')))).toBe(true);
        const ok = await images.evaluateAll(async (els) => {
            const out: boolean[] = [];
            for (const e of els) {
                const b = await (await fetch(e.getAttribute('href')!)).blob();
                const bmp = await createImageBitmap(b);
                out.push(b.type === 'image/png' && bmp.width === 120);
            }
            return out;
        });
        expect(ok).toEqual([true, true, true]);
        // The tree's cards are gone: their URLs too, but those the fan shows (the same pictures).
        const fanUrls = await images.evaluateAll(els => els.map(e => e.getAttribute('href')));
        expect(fanUrls.includes(cardUrl) || !(await alive(page, cardUrl))).toBe(true);
    });

    test('the materials: the person\'s attachment and the window\'s tile show the pooled file; the viewer shows it and Download saves its bytes', async ({ page }) => {
        await treeWithRefs(page);
        const scan = await drawn(page, 5, 300, 200);
        await page.evaluate((dataUrl) => {
            window.Strom.UI.toggleAdvancedFields(true);
            window.Strom.DataManager.addAttachment('kasimir' as never, { name: 'zwirnhof-brief.png', mimeType: 'image/png', dataUrl, sizeBytes: 5000 });
        }, scan);
        const refs = await poolInMemory(page);
        const ref = refs[scan];
        expect(ref).toBeTruthy();

        // The person's attachments in the edit dialog.
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal('kasimir');
        });
        const thumb = '#person-modal #attachments-list .attachment-row img';
        await expect(page.locator(thumb).first()).toHaveAttribute('data-pool-ref', idOf(ref));
        // Below the dialog's fold: put in once scrolled to.
        await page.locator(thumb).first().scrollIntoViewIfNeeded();
        await expectShown(page, thumb);
        // The portrait above it as well.
        await expect(page.locator('#person-modal #photo-preview img')).toHaveAttribute('data-pool-ref', /^p:[0-9a-f]{40}$/);
        await page.locator('#person-modal #photo-preview img').scrollIntoViewIfNeeded();
        await expectShown(page, '#person-modal #photo-preview img');
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-modal')).toBeHidden();

        // The materials window's tile, then the viewer.
        await page.evaluate(() => window.Strom.UI.openMaterials());
        const tile = page.locator('#materials-modal .mw-canvas .mw-tile', { hasText: 'zwirnhof-brief' });
        await expect(tile.locator('img')).toHaveAttribute('data-pool-ref', idOf(ref));
        await expectShown(page, '#materials-modal .mw-canvas .mw-tile img[data-pool-ref]');
        await tile.click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await expectShown(page, '#attachment-overlay-img');
        expect(await page.locator('#attachment-overlay-img').evaluate(i => (i as HTMLImageElement).naturalWidth)).toBe(300);

        // Download: the pool's bytes, under the file's name.
        const download = page.waitForEvent('download');
        await page.locator('#image-viewer-panel .mv-act[data-action="download"]').click();
        const saved = await download;
        expect(saved.suggestedFilename()).toBe('zwirnhof-brief.png');
        expect(saved.url()).toMatch(/^blob:/);
        const fs = await import('node:fs/promises');
        const bytes = await fs.readFile((await saved.path())!);
        expect(bytes.toString('base64')).toBe(scan.split(',')[1]);
        expect(page.context().pages()).toHaveLength(1);
    });

    test('a source\'s excerpt held as a reference: a research crop shows upright in the source viewer', async ({ page }) => {
        await treeWithRefs(page);
        const crop = await page.evaluate(() => {
            const c = document.createElement('canvas');
            c.width = 400; c.height = 100;
            const g = c.getContext('2d')!;
            for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 37 % 360} 50% 50%)`; g.fillRect(i * 10, (i * 13) % 60, 10, 40); }
            return c.toDataURL('image/jpeg', 0.92);
        });
        const sourceId = await page.evaluate((dataUrl) => {
            const dm = window.Strom.DataManager;
            const src = dm.addSource({ title: 'Taufbuch Zwirnhof', excerpts: [{ id: 'e1', dataUrl, width: 400, height: 100, sizeBytes: 3000, orient: 6 }] } as never)!;
            dm.citePerson('kasimir' as never, src.id);
            return src.id as string;
        }, crop);
        const refs = await poolInMemory(page);
        const ref = refs[crop];
        expect(ref).toBeTruthy();
        await page.evaluate((id) => window.Strom.UI.showSourceViewer(id, null), sourceId);
        const img = '#source-viewer-modal img[data-excerpt-index]';
        await expect(page.locator(img).first()).toHaveAttribute('data-pool-ref', `${idOf(ref)}@o6`);
        await expectShown(page, img);
        expect(await page.locator(img).first().evaluate(async (i: HTMLImageElement) => {
            await i.decode().catch(() => undefined);
            return { w: i.naturalWidth, h: i.naturalHeight };
        })).toEqual({ w: 100, h: 400 });
        // The tree keeps the reference as it was, the orientation beside it.
        const kept = await page.evaluate((id) => {
            const e = window.Strom.DataManager.getData().sources![id].excerpts![0];
            return { dataUrl: e.dataUrl, orient: e.orient };
        }, sourceId);
        expect(kept).toEqual({ dataUrl: ref, orient: 6 });
    });

    test('the portrait editor opens over a pooled portrait; its result is a new picture', async ({ page }) => {
        await treeWithRefs(page);
        // A portrait large enough to zoom into (a small one stays at 100 %).
        const big = await drawn(page, 6, 900, 600);
        await page.evaluate((photo) => window.Strom.DataManager.updatePerson('walpurga' as never, { photo }), big);
        const refs = await poolInMemory(page);
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal('walpurga');
        });
        await expectShown(page, '#person-modal #photo-preview img');
        await page.locator('#person-modal #photo-recrop-btn').click();
        const editor = page.locator('.pe-overlay');
        await expect(editor).toBeVisible();
        await expect(editor.locator('.pe-note-original')).toBeVisible();
        await expect(editor.locator('.pe-frame')).toBeFocused();
        await page.keyboard.press('+');
        await expect(editor.locator('.pe-pct')).toHaveText('110 %');
        await editor.getByRole('button', { name: 'Done' }).click();
        await expect(editor).toHaveCount(0);
        const preview = await page.locator('#person-modal #photo-preview img').getAttribute('src');
        expect(preview).toMatch(/^data:image\//);
        // Nothing written before Save: the tree still holds the reference.
        expect(await page.evaluate(() => window.Strom.DataManager.getData().persons['walpurga' as never].photo)).toBe(refs[big]);
    });

    test('the fan poster and a saved person page carry the pooled pictures whole (D5a)', async ({ page }) => {
        const refs = await treeWithRefs(page);
        /** The references of the data URLs in a file (the pool's id is SHA-256 of the data URL). */
        const refsIn = (text: string): string[] => [...new Set(text.match(/data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+/g) ?? [])]
            .map(url => '\u0000sm:p:' + createHash('sha256').update(url).digest('hex').slice(0, 40));
        await page.evaluate(() => {
            window.Strom.TreeRenderer.setFanPortraits(true);
            window.Strom.UI.setDisplayViewMode('fan');
        });
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        const [poster] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.Strom.UI.exportPosterSvg())]);
        const svg = readFileSync(await poster.path(), 'utf-8');
        expect(svg).not.toContain('data-pool-ref');
        expect(svg).not.toContain('\u0000');
        expect(refsIn(svg)).toEqual(expect.arrayContaining(['kasimir', 'walpurga', 'leopoldine'].map(id => refs[id])));

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('tree'));
        await card(page, 'Leopoldine').click();
        await page.locator('.context-menu .context-menu-header--page').click();
        await page.locator('#person-page-modal .pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg).toBeVisible();
        const [saved] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await saved.path(), 'utf-8');
        expect(html).not.toContain('data-pool-ref');
        expect(html).not.toContain('\u0000sm:');
        expect(refsIn(html)).toContain(refs.leopoldine);
        // The tree in memory keeps its references.
        expect(await page.evaluate(() => window.Strom.DataManager.getData().persons['leopoldine' as never].photo)).toBe(refs.leopoldine);
    });
});
