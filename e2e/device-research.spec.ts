import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { card, seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * The research on a second computer and on a phone of the home network
 * (spec 094 P3, §6, §8 1-2): the app opened from a fake gateway of the
 * research and paired there asks the tree's bridge through the sealed tunnel
 * (the gateway gets every request, none goes to /__device/ itself), its
 * Research menu on a computer with a mouse holds only what a device does
 * through the bridge (Overview, Follow live, Awaiting action, Send changes;
 * under "Other actions" Materials and Add materials…, one quiet line where
 * the rest is) and its group in the phone's More sheet the same, never a
 * mark of the terminal or of the agent; an image of the bridge shows as a
 * blob URL. Invented data only (the Pýchavkovi of Mlýnky, the computer
 * "Pracovna").
 */

const TREE = '7c3e1f20-5a4b-4d6e-9f80-1a2b3c4d5e6f';
const HEAD = '5d2e8a7c1b94';
const PNG = readFileSync('e2e/fixtures/avatar.png');
const SHA = createHash('sha256').update(PNG).digest('hex');
/** A PDF of the bridge (opened in a new tab) and a HEIC (the viewer's card with the research's preview). */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PDF_SHA = createHash('sha256').update(PDF).digest('hex');
const HEIC_SHA = createHash('sha256').update('nahrobek.heic').digest('hex');
const ACCEPTS = {
    mode: 'research', sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } },
};
/** Everything a research on the computer offers there: none of it reaches a device but what §6 allows. */
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'review', 'research', 'work', 'update', 'sync-undo', 'fixes', 'doctor'];
const FEATURES = ['device.gateway', 'material.list', 'material.assign', 'material.thumb', 'material.sort'];
const DEVICE_ACTIONS = ['device.rename', 'device.unpair', 'conflict.decide', 'hypothesis.decide', 'sync.undo'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${TREE}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Pýchavkovi z Mlýnků',
    '0 @P0001@ INDI', '1 NAME Bonifác /Pýchavka/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Holubinka /Ryzcová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Hřibík /Pýchavka/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');

function status(device: { id: string; name: string; kind: string }): Record<string, unknown> {
    return {
        ok: true,
        tree: { id: TREE, name: 'Pýchavkovi z Mlýnků' }, head: HEAD, links: LINKS, accepts: ACCEPTS,
        inbox: { trees: [], material: 0 }, lastIntake: null, sends: [],
        waiting: [{ id: 'T0001', what: 'Potvrdit křest Hřibíka' }],
        features: FEATURES,
        device: { id: device.id, name: device.name, kind: device.kind, actions: DEVICE_ACTIONS },
    };
}

/** The bridge of the tree behind the gateway: its status, the tree, its material and a preview. */
function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') return { s: 200, body: status(device) };
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (req.p === 'material') {
        return { s: 200, body: {
            files: [{ id: 'I0001', name: 'svatba-1924.png', sha: SHA, mime: 'image/png', bytes: PNG.length, at: '2026-11-20T10:00:00Z',
                persons: ['P0001'], state: 'processed', kind: 'photo', title: 'Svatba 1924' },
            { id: 'I0002', name: 'kronika-mlynky.pdf', sha: PDF_SHA, mime: 'application/pdf', bytes: PDF.length, at: '2026-11-20T10:05:00Z',
                persons: ['P0001'], state: 'processed', kind: 'document', title: 'Kronika Mlýnků' },
            { id: 'I0003', name: 'nahrobek.heic', sha: HEIC_SHA, mime: 'image/heic', bytes: 2_400_000, at: '2026-11-20T10:10:00Z',
                persons: ['P0001'], state: 'processed', kind: 'photo', title: 'Náhrobek v Mlýnkách' }],
            batches: [], people: { P0001: 'Bonifác Pýchavka' },
        } };
    }
    if (req.p === `media/${SHA}`) return { s: 200, h: { 'Content-Type': 'image/png' }, body: new Uint8Array(PNG) };
    if (req.p === `media/${PDF_SHA}`) return { s: 200, h: { 'Content-Type': 'application/pdf' }, body: new Uint8Array(PDF) };
    // The research's preview of the HEIC (a PNG here).
    if (req.p === `media/${HEIC_SHA}` && req.q?.thumb) return { s: 200, h: { 'Content-Type': 'image/png' }, body: new Uint8Array(PNG) };
    return undefined;
}

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
    gw.trees = [{ id: TREE, name: 'Pýchavkovi z Mlýnků', archive: false }];
    gw.onTunnel = bridge;
});
test.afterEach(async () => {
    await gw.close();
});

/** Any request of the page to a device base itself (it must go through the interceptor, never the network). */
function watchDirect(page: Page): string[] {
    const direct: string[] = [];
    page.on('request', r => { if (r.url().includes('/__device/')) direct.push(r.url()); });
    return direct;
}

/**
 * The app opened from the gateway's QR code and paired, the tree of the research in it (the start loads it through
 * the gateway), the bridge asked once through the tunnel.
 */
async function pairedTree(page: Page, opts: { lang: 'en' | 'de'; width: number; dark: boolean }): Promise<void> {
    await page.setViewportSize({ width: opts.width, height: opts.width < 641 ? 844 : 900 });
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
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
    expect(gw.devices).toHaveLength(1);
    await page.evaluate(() => {
        // Opening links in the system is never done here: record any (none is expected).
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    // The start loads the research's tree through the gateway, editable (as the research's tree on the computer).
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
    await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
}

const LABELS = {
    en: {
        first: ['Research overview', 'Follow live', 'Awaiting action', 'Send changes', 'Other actions'],
        more: ['Materials', 'Add materials…'],
        only: 'Approvals and research settings are on Pracovna.',
    },
    de: {
        first: ['Forschungsübersicht', 'Live verfolgen', 'Wartet auf Bearbeitung', 'Änderungen senden', 'Weitere Aktionen'],
        more: ['Materialien', 'Materialien hinzufügen…'],
        only: 'Zustimmungen und Forschungseinstellungen sind auf Pracovna.',
    },
} as const;

/** Nothing on the page wider than the window. */
async function noSideways(page: Page): Promise<void> {
    const sizes = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, w: window.innerWidth }));
    expect(sizes.doc).toBeLessThanOrEqual(sizes.w);
    expect(sizes.body).toBeLessThanOrEqual(sizes.w);
}

/** Elements inside `sel` that reach past its own right edge or the window's. */
async function overflowing(page: Page, sel: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement | null;
        if (!root) return ['(none)'];
        const out: string[] = [];
        const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth) + 1;
        if (root.scrollWidth > root.clientWidth + 1) out.push(`${sel} scrolls sideways`);
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > edge) out.push(`${el.className || el.tagName}: ${Math.round(r.right)} > ${Math.round(edge)}`);
        }
        return out;
    }, sel);
}

/** No mark of the terminal or of the agent in `sel`. */
async function noMarks(page: Page, sel: string): Promise<void> {
    const root = page.locator(sel);
    await expect(root.locator('.research-open-mark, .research-ai-badge, .research-open-sr')).toHaveCount(0);
}

test.describe('the research through the gateway', () => {
    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`a second computer (mouse, 1440, ${lang}${dark ? ', dark' : ''}): the menu of what a device does, one quiet line, no phone dot, no mark`, async ({ page }) => {
                const direct = watchDirect(page);
                await pairedTree(page, { lang, width: 1440, dark });
                // The status asked through the tunnel, of this tree, with the app's version.
                const asked = gw.tunnelled.filter(r => r.p === 'status');
                expect(asked.length).toBeGreaterThan(0);
                expect(asked.at(-1)).toMatchObject({ m: 'GET', tree: TREE });

                const btn = page.locator('#research-menu-btn');
                await expect(btn).toBeVisible();
                // The phone's dot is the computer's (its devices): none here.
                await expect(btn.locator('.research-menu-phone')).toBeHidden();
                await btn.click();
                const menu = page.locator('#research-menu');
                await expect(menu).toBeVisible();
                const L = LABELS[lang];
                await expect(menu.locator('> .research-menu-group > .tree-switcher-action .research-item-label')).toHaveText([...L.first]);
                await page.locator('#research-item-more').click();
                await expect(page.locator('#research-menu-more')).toBeVisible();
                await expect(page.locator('#research-menu-more .research-item-label')).toHaveText([...L.more]);
                await expect(page.locator('#research-menu-only-computer')).toHaveText(L.only);
                // Nothing of the terminal, the agent, the devices, the research's tools or settings.
                for (const id of ['chat', 'open', 'phone', 'tools', 'setup', 'tree-settings', 'queue-work', 'read', 'verify', 'undo', 'version', 'update', 'fixes', 'start', 'install', 'about']) {
                    await expect(page.locator(`#research-item-${id}`), id).toHaveCount(0);
                }
                await noMarks(page, '#research-menu');
                // The footer says no mark either (nothing carries one).
                await expect(page.locator('#research-menu-foot .research-menu-foot-text')).toHaveCount(0);
                expect(await overflowing(page, '#research-menu')).toEqual([]);
                await noSideways(page);
                // Nothing handed to the system, nothing asked of the gateway's own address for the bridge.
                expect(await page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([]);
                expect(direct).toEqual([]);
                expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
            });
        }
    }

    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test.describe(`a phone (touch, 390, ${lang}${dark ? ', dark' : ''})`, () => {
                test.use({ hasTouch: true, isMobile: true });

                test('the More sheet\'s research group and all its actions without a mark of the terminal or the agent', async ({ page }) => {
                    const direct = watchDirect(page);
                    await pairedTree(page, { lang, width: 390, dark });
                    await expect(page.locator('#research-menu-btn')).toBeHidden();
                    await page.locator('#bb-view-more').tap();
                    const sheet = page.locator('.bottom-sheet-menu');
                    await expect(sheet).toBeVisible();
                    const items = sheet.locator('.bottom-sheet-items');
                    await expect(items.locator('.research-sheet-heading')).toHaveCount(1);
                    await noMarks(page, '.bottom-sheet-menu');
                    expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
                    await noSideways(page);
                    // "All research actions ›": the whole menu as a page of the sheet, still without a mark.
                    await page.locator('#research-sheet-all').tap();
                    await expect(page.locator('#research-item-overview')).toBeVisible();
                    const L = LABELS[lang];
                    await expect(page.locator('.bottom-sheet-menu .research-menu-group:not(.is-quiet) .research-item-label').first()).toHaveText(L.first[0]);
                    for (const id of ['chat', 'open', 'phone', 'tools', 'setup', 'tree-settings']) {
                        await expect(page.locator(`#research-item-${id}`), id).toHaveCount(0);
                    }
                    await expect(page.locator('#research-menu-only-computer')).toHaveText(L.only);
                    await noMarks(page, '.bottom-sheet-menu');
                    expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
                    await noSideways(page);
                    expect(direct).toEqual([]);
                    expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
                });
            });
        }
    }

    test('the materials\' previews and the viewer\'s image come through the tunnel as blob URLs, never from the address itself', async ({ page }) => {
        const direct = watchDirect(page);
        await pairedTree(page, { lang: 'en', width: 1440, dark: false });
        await page.locator('#research-menu-btn').click();
        await page.locator('#research-item-more').click();
        await page.locator('#research-item-materials').click();
        const win = page.locator('#materials-modal');
        const tile = win.locator('.mw-canvas .mw-tile', { hasText: 'Svatba 1924' });
        await expect(tile).toBeVisible();
        // The preview: asked through the tunnel (the tree's bridge), shown by a blob URL.
        await expect(tile.locator('img')).toHaveAttribute('src', /^blob:/);
        expect(gw.tunnelled.find(r => r.p === 'material')).toMatchObject({ m: 'GET', tree: TREE });
        expect(gw.tunnelled.some(r => r.p === `media/${SHA}` && !!r.q?.thumb)).toBe(true);

        // The viewer: the preview, then the file itself, both through the tunnel.
        await tile.click();
        const overlay = page.locator('#attachment-overlay');
        await expect(overlay).toHaveClass(/active/);
        const image = page.locator('#attachment-overlay-img');
        await expect.poll(() => gw.tunnelled.some(r => r.p === `media/${SHA}` && r.q?.file === '1')).toBe(true);
        await expect(image).toHaveAttribute('src', /^blob:/);
        await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        // An image of the file, not the card of a file that could not be shown.
        await expect(overlay).not.toHaveClass(/is-card/);
        await expect(image).toBeVisible();

        expect(direct).toEqual([]);
        expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
    });
    test('a PDF of the bridge opens in a new tab from the bytes read through the tunnel, never from the address itself', async ({ page }) => {
        const direct = watchDirect(page);
        await pairedTree(page, { lang: 'en', width: 1440, dark: false });
        await page.locator('#research-menu-btn').click();
        await page.locator('#research-item-more').click();
        await page.locator('#research-item-materials').click();
        const tile = page.locator('#materials-modal .mw-canvas .mw-tile', { hasText: 'Kronika Mlýnků' });
        await expect(tile).toBeVisible();
        // The new tab recorded (a headless browser saves a PDF instead of showing it): opened empty within the
        // click, then sent to a blob URL of the bytes the tunnel brought.
        await page.evaluate(() => {
            const w = window as unknown as { __opened: string[]; open: (u?: string) => unknown };
            w.__opened = [];
            w.open = (u?: string) => {
                w.__opened.push(u ?? '');
                return { closed: false, close() { this.closed = true; }, location: { set href(v: string) { w.__opened.push(v); }, get href() { return ''; } } };
            };
        });
        await tile.click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['', expect.stringMatching(/^blob:/)]);
        const blob = await page.evaluate(async () => {
            const url = (window as unknown as { __opened: string[] }).__opened[1];
            const b = await (await fetch(url)).blob();
            return { type: b.type, head: (await b.text()).slice(0, 8) };
        });
        expect(blob).toEqual({ type: 'application/pdf', head: '%PDF-1.4' });
        expect(gw.tunnelled.some(r => r.p === `media/${PDF_SHA}` && r.q?.file === '1')).toBe(true);
        expect(direct).toEqual([]);
        expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
    });

    test('the viewer\'s card of a file the browser does not show has the research\'s preview as a blob URL', async ({ page }) => {
        const direct = watchDirect(page);
        await pairedTree(page, { lang: 'en', width: 1440, dark: false });
        await page.locator('#research-menu-btn').click();
        await page.locator('#research-item-more').click();
        await page.locator('#research-item-materials').click();
        const tile = page.locator('#materials-modal .mw-canvas .mw-tile', { hasText: 'Náhrobek v Mlýnkách' });
        await expect(tile).toBeVisible();
        await tile.click();
        const overlay = page.locator('#attachment-overlay');
        await expect(overlay).toHaveClass(/is-card/);
        const preview = overlay.locator('.mv-card-tile img');
        await expect(preview).toHaveAttribute('src', /^blob:/);
        await expect.poll(() => preview.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        expect(gw.tunnelled.some(r => r.p === `media/${HEIC_SHA}` && !!r.q?.thumb)).toBe(true);
        expect(direct).toEqual([]);
        expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
    });
});
