import { test, expect, Page } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * Following live and the layouts of a device of the home network (spec 094 §4,
 * points 9-10): the device's tree is the research's already and editable, so
 * the overview carries no "the tree switches to the research's version" strip
 * nor its button; following live stays an option of the research's actions,
 * the tree read-only meanwhile with today's follow panel, and editable again
 * once it ends. A tablet held upright has the More sheet in the middle, held
 * sideways the overview as today's overlay panel at the right; dark and 360 px
 * keep everything inside. Invented data only (the Pýchavkovi of Mlýnky, the
 * computer "Pracovna").
 */

const TREE = '7c3e1f20-5a4b-4d6e-9f80-1a2b3c4d5e6f';
const HEAD = '5d2e8a7c1b94';
/** The page's clock (not midnight UTC); the gateway's clock goes with it. */
const T = new Date('2026-11-24T10:30:00Z');
const at = (min: number): string => new Date(T.getTime() + min * 60_000).toISOString();
const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${TREE}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Pýchavkovi z Mlýnků',
    '0 @P0001@ INDI', '1 NAME Bonifác /Pýchavka/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Holubinka /Ryzcová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Hřibík /Pýchavka/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');
const ACCEPTS = { mode: 'research', sync: { auto: 'off' }, sources: true, media: { max: 50 * 1024 * 1024, taskImages: true, tasks: 'open' } };
const FEATURES = ['device.gateway', 'material.list', 'waiting.groups', 'waiting.answer', 'waiting.sent', 'run.lines', 'run.stop'];
const CAPS = { directionsWrite: true, directionsOrder: true, orderMode: 'weight', directionKinds: ['ancestors', 'descendants', 'question'], duplicateDirections: false, offLineBranches: false };
const LINE = { name: 'Pýchavkovi z Mlýnků po meči', state: 'active', direction: 'ancestors', waiting: 0, working: false, since: at(-3000), canStart: false };
/** Lines with long names (German at 360 px keeps them on their rows). */
const LINES = (): Record<string, unknown>[] => [
    { ...LINE, id: 'G0001', focus: 'P0003', order: 1, tasks: 3 },
    { ...LINE, id: 'G0002', name: 'Ryzcovi z Lipové po přeslici und ihre Vorfahren in Mährisch-Schönberg', focus: 'P0002', order: 2, tasks: 2 },
    { ...LINE, id: 'G0003', name: 'Hřibík a jeho sourozenci', direction: 'descendants', focus: 'P0001', order: 3, tasks: 1 },
];

interface Scene {
    researches: Record<string, unknown>[];
    actions: string[];
    /** Answers of writes by `<method> <path>` (else the bridge's own). */
    refuse: Record<string, TunnelReply>;
    /** Every write through the tunnel. */
    writes: DeviceRequest[];
    /** The research's history (`GET log`) and its sends (`status.sends`). */
    log: Record<string, unknown>[];
    sends: (device: { id: string; name: string }) => Record<string, unknown>[];
}
let scene: Scene;

/** A write's JSON body as an object. */
const bodyOf = <B>(req: DeviceRequest): B => (typeof req.b === 'string' ? JSON.parse(req.b) : req.b ?? {}) as B;

function status(device: { id: string; name: string; kind: string }): Record<string, unknown> {
    return {
        ok: true, tree: { id: TREE, name: 'Pýchavkovi z Mlýnků' }, head: HEAD, links: ['send', 'open', 'live', 'app', 'setup', 'chat', 'task'],
        accepts: ACCEPTS, inbox: { trees: [], material: 0 }, lastIntake: null, sends: scene.sends(device), features: FEATURES, caps: CAPS,
        waiting: [], working: [], runs: [], runsEnded: [], researches: scene.researches, queue: [],
        device: { id: device.id, name: device.name, kind: device.kind, actions: scene.actions },
    };
}

function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') return { s: 200, body: status(device) };
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (req.p === 'material') return { s: 200, body: { files: [], batches: [], people: {} } };
    if (req.p === 'log') return { s: 200, body: { entries: scene.log } };
    if (req.m === 'GET') return undefined;
    scene.writes.push(req);
    const refused = scene.refuse[`${req.m} ${req.p}`];
    if (refused) return refused;
    if (req.p === 'directions/order') {
        const order = bodyOf<{ order: string[] }>(req).order;
        scene.researches = order.map((id, i) => ({ ...scene.researches.find(d => d.id === id)!, order: i + 1 }));
        return { s: 200, body: { order, ignored: [], head: HEAD } };
    }
    const state = /^directions\/(G\d+)\/state$/.exec(req.p);
    if (state) {
        const what = bodyOf<{ do: string }>(req).do;
        scene.researches = scene.researches.map(d => d.id === state[1] ? { ...d, state: what === 'pause' ? 'paused' : what === 'done' ? 'done' : 'active' } : d);
        return { s: 200, body: { direction: scene.researches.find(d => d.id === state[1]), head: HEAD } };
    }
    const undo = /^device\/sync\/(I\d+)\/undo$/.exec(req.p);
    if (undo) {
        if (bodyOf<{ dry?: boolean }>(req).dry) {
            if (undone.has(undo[1])) return { s: 200, body: { input: undo[1], undone: 0, undoneAt: at(-10) } };
            return { s: 200, body: { input: undo[1], undone: 3, fields: [
                { what: 'Birth – Hřibík Pýchavka', field: 'date', from: '3 APR 1902', to: '1902', event: 'E0031', person: 'P0003' },
                { what: 'Marriage – Bonifác Pýchavka', field: 'place', from: 'Mlýnky', to: '', event: 'E0040', family: 'F0001' },
                { what: 'Note – Hřibík Pýchavka', field: 'fact', from: 'The miller of Mlýnky', to: '', event: 'E0041', person: 'P0003' },
            ], kept: [{ event: 'E0031', fields: ['place'], what: 'Birth – Hřibík Pýchavka', by: 'send', client: { id: 'dv_ipad0000000000000000000000000', name: 'iPad · Safari' } }] } };
        }
        undone.add(undo[1]);
        return { s: 200, body: { input: undo[1], undone: true, fields: [] } };
    }
    return undefined;
}

/** The sends undone through the gateway (their state then says it). */
const undone = new Set<string>();
const IPAD = { id: 'dv_ipad0000000000000000000000000', name: 'iPad · Safari' };
/** Progress: one change from another device, one of the agent, one from the computer, one story (newest first). */
const LOG = (): Record<string, unknown>[] => [
    { head: 'a5', at: at(-5), what: ['~P0003'], text: ['Hřibík Pýchavka: birth 1902 in Mlýnky'], kinds: ['person'], task: '', via: IPAD },
    { head: 'a4', at: at(-60), what: ['~P0002'], text: ['Holubinka Ryzcová: marriage 1899 in Lipová, record of the parish of Mährisch-Schönberg'], kinds: ['person'], task: 'T0012' },
    { head: 'a3', at: at(-120), what: ['+S0031'], text: ['Register of births Mlýnky 1895–1910'], kinds: ['source'], task: '', via: { id: 'cl_pracovna', name: 'Pracovna' } },
    { head: 'a2', at: at(-200), what: ['~P0001'], text: ['Bonifác Pýchavka: the mill story'], kinds: ['story'], task: 'T0011' },
];
/** This device's send (undoable) and the iPad's. */
const SENDS = (device: { id: string; name: string }): Record<string, unknown>[] => [
    { intake: 'in7', at: at(-30), state: undone.has('I0007') ? 'undone' : 'written', changes: 2, input: 'I0007', client: { id: device.id, name: device.name } },
    { intake: 'in6', at: at(-90), state: 'written', changes: 1, input: 'I0006', client: IPAD },
];

let gw: FakeGateway;
test.beforeEach(async () => {
    scene = { researches: LINES(), actions: ['device.rename', 'device.unpair'], refuse: {}, writes: [], log: [], sends: () => [] };
    undone.clear();
    gw = await startDeviceGateway();
    gw.trees = [{ id: TREE, name: 'Pýchavkovi z Mlýnků', archive: false }];
    gw.onTunnel = bridge;
    // The gateway's clock goes with the page's (a sealed request carries its time).
    gw.clockOffsetMs = T.getTime() - Date.now();
});
test.afterEach(async () => {
    await gw.close();
});

/** Where the screenshots of the review go (de at 360, 390, 768 and 1024, light and dark), when asked for: STROM_SHOTS=<folder>. */
type Lang = 'en' | 'de';
const SHOTS = process.env.STROM_SHOTS ?? '';
const shot = async (page: Page, name: string): Promise<void> => {
    if (!SHOTS) return;
    await page.waitForTimeout(400); // (a tap's highlight gone)
    await page.screenshot({ path: `${SHOTS}/d5c-${name}.png` });
};

/** Paired from the gateway's QR code, the research's tree loaded through it (editable), the bridge asked. */
async function paired(page: Page, opts: { lang: Lang; width: number; dark: boolean }): Promise<void> {
    await page.clock.setFixedTime(T);
    await page.setViewportSize({ width: opts.width, height: opts.width < 641 ? 780 : opts.width <= 800 ? 1024 : 768 });
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
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.person-card', { hasText: 'Hřibík' }).first()).toBeVisible();
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ modeAsked: true, skipPreview: true, placesOffer: 'done' }));
    });
    if (opts.lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await poll(page);
}

/** The research's overview opened as the More sheet's row does. */
async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { researchActionOverview(): void }).researchActionOverview());
    await expect(page.locator('#research-overview')).toBeVisible();
}

/** A section of the overview unfolded. */
async function unfold(page: Page, key: string): Promise<void> {
    const head = page.locator(`#research-overview [aria-controls="ov-sec-${key}"]`);
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

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
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > edge && getComputedStyle(el).position !== 'fixed') out.push(`${el.className || el.tagName}: ${Math.round(r.right)} > ${Math.round(edge)}`);
        }
        return out;
    }, sel);
}

/** Pairs of `sel`'s elements whose boxes share area (rows of a list never overlap). */
async function overlapping(page: Page, sel: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(e => e.getBoundingClientRect().width > 0);
        const out: string[] = [];
        for (let i = 0; i < els.length; i++) {
            for (let j = i + 1; j < els.length; j++) {
                const a = els[i].getBoundingClientRect();
                const b = els[j].getBoundingClientRect();
                if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${i}×${j}`);
            }
        }
        return out;
    }, sel);
}


const L = {
    en: { follow: 'Follow live', stop: 'End following', note: 'The tree switches to the research version and is not editable.' },
    de: { follow: 'Live verfolgen', stop: 'Verfolgung beenden', note: 'Der Stammbaum wechselt zur Forschungsversion und ist nicht bearbeitbar.' },
} as const;

/** The scene of a working research: its lines, Progress with the sends. */
function busyScene(): void {
    scene.log = LOG();
    scene.sends = SENDS;
    scene.actions = ['device.rename', 'device.unpair', 'sync.undo'];
}

/** Whether the open tree follows the research live and is locked. */
async function following(page: Page): Promise<{ on: boolean; locked: boolean }> {
    return page.evaluate(() => ({ on: window.Strom.DataManager.isLiveFollowing(), locked: window.Strom.DataManager.isTreeLocked() }));
}

/** The research's actions opened from the More sheet (All research actions ›). */
async function allActions(page: Page): Promise<void> {
    await page.locator('#bb-view-more').tap();
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    await page.locator('#research-sheet-all').tap();
    await expect(page.locator('#research-sheet-menu')).toBeVisible();
}

test.describe('following live on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`the overview without the follow strip; following from the actions, read-only, then editable again (390, ${lang}${dark ? ', dark' : ''})`, async ({ page }) => {
                busyScene();
                await paired(page, { lang, width: 390, dark });
                const t = L[lang];
                // The device's tree is the research's, editable.
                expect(await following(page)).toEqual({ on: false, locked: false });
                await openOverview(page);
                const ov = page.locator('#research-overview');
                await expect(ov).toHaveClass(/research-overview--sheet/);
                await expect(ov.locator('.research-overview__follow, .research-overview__follow-live, .research-overview__window-note')).toHaveCount(0);
                await expect(ov).not.toContainText(t.note);
                expect(await overflowing(page, '#research-overview')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `overview-de-390${dark ? '-dark' : ''}`);
                await page.evaluate(() => (window.Strom.UI as unknown as { closeResearchOverview(): void }).closeResearchOverview());

                // Following live is an option of the research's actions, without a mark (it stays in the app).
                await allActions(page);
                const live = page.locator('#research-sheet-menu #research-item-live');
                await expect(live).toHaveText(t.follow);
                await expect(live.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
                await live.tap();
                await expect.poll(() => following(page)).toEqual({ on: true, locked: true });
                // Today's follow panel, with its Stop; nothing of the tree to send meanwhile.
                const panel = page.locator('#live-panel');
                await expect(panel).toBeVisible();
                await expect(panel.getByRole('button', { name: t.stop })).toBeVisible();
                await noSideways(page);
                if (lang === 'de') await shot(page, `following-de-390${dark ? '-dark' : ''}`);
                await allActions(page);
                await expect(page.locator('#research-sheet-menu #research-item-stop')).toHaveText(t.stop);
                await expect(page.locator('#research-sheet-menu #research-item-send')).toHaveCount(0);
                await page.locator('#research-sheet-menu #research-item-stop').tap();
                await expect.poll(() => following(page)).toEqual({ on: false, locked: false });
            });
        }
    }
});

/** Two boxes that share some area. */
function overlap(a: { x: number; y: number; width: number; height: number } | null, b: typeof a): boolean {
    if (!a || !b) return false;
    return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

test.describe('a tablet of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const dark of [false, true]) {
        test(`held upright (768 × 1024${dark ? ', dark' : ''}): the More sheet in the middle with the research's group`, async ({ page }) => {
            busyScene();
            await paired(page, { lang: 'de', width: 768, dark });
            await page.locator('#bb-view-more').tap();
            const sheet = page.locator('.bottom-sheet-menu');
            await expect(sheet).toBeVisible();
            await expect(sheet.locator('#sheet-research-item-overview')).toBeVisible();
            await expect(sheet.locator('#research-sheet-all')).toBeVisible();
            await expect(sheet.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
            const box = (await sheet.boundingBox())!;
            // In the middle of the width, narrower than the screen.
            expect(box.width).toBeLessThan(768 - 100);
            expect(Math.abs(box.x - (768 - box.x - box.width))).toBeLessThanOrEqual(2);
            // Its rows are touch targets.
            for (const row of await sheet.locator('[id^="sheet-research-item-"], #research-sheet-all').all()) {
                expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            }
            expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
            await noSideways(page);
            await shot(page, `more-de-768${dark ? '-dark' : ''}`);
        });

        test(`held sideways (1024 × 768${dark ? ', dark' : ''}): the overview as today's overlay panel at the right, without the follow strip`, async ({ page }) => {
            busyScene();
            await paired(page, { lang: 'de', width: 1024, dark });
            await openOverview(page);
            const ov = page.locator('#research-overview');
            await expect(ov).toHaveClass(/research-overview--overlay/);
            const box = (await ov.boundingBox())!;
            // 412 px from the right edge: the panel and its margin.
            expect(Math.round(1024 - box.x)).toBe(412);
            await expect(ov.locator('.research-overview__follow, .research-overview__follow-live')).toHaveCount(0);
            await expect(ov).not.toContainText(L.de.note);
            // Its head's buttons are touch targets.
            for (const b of await ov.locator('.research-overview__head button:visible').all()) {
                expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            }
            // The home-screen icon's line and the toolbar stay seen above it.
            expect(overlap(await page.locator('#device-home-line').boundingBox(), box)).toBe(false);
            await unfold(page, 'timeline');
            expect(await overflowing(page, '#research-overview')).toEqual([]);
            await noSideways(page);
            await shot(page, `overview-de-1024${dark ? '-dark' : ''}`);
        });
    }
});

test.describe('a small phone (360) in the dark', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('the More sheet, the research\'s actions and the overview keep everything inside', async ({ page }) => {
        busyScene();
        await paired(page, { lang: 'de', width: 360, dark: true });
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('#research-sheet-all')).toBeVisible();
        expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
        await noSideways(page);
        await shot(page, 'more-de-360-dark');
        await page.locator('#research-sheet-all').tap();
        await expect(page.locator('#research-sheet-menu #research-item-live')).toBeVisible();
        expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
        await shot(page, 'actions-de-360-dark');
        await page.keyboard.press('Escape');
        await openOverview(page);
        await unfold(page, 'directions');
        expect(await overflowing(page, '#research-overview')).toEqual([]);
        expect(await overlapping(page, '#research-overview .research-direction--managed')).toEqual([]);
        await noSideways(page);
        await shot(page, 'overview-de-360-dark');
    });
});
