import { test, expect, Page } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * The research on a phone of the home network (spec 094 §4, points 4-6): a
 * line's ⋯ (44 px) opens "Line actions" from below (the moves, Pause, End…,
 * Show in tree; working on it with its agent is the computer's), Progress with
 * what is new since it was last seen, each send with its source and "Undo this
 * send", a person's conflict and hypothesis decided through the gateway's own
 * paths. Every write goes through the fake gateway's tunnel; a
 * `403 device.computer-only` takes the action away with one quiet sentence.
 * Invented data only (the Pýchavkovi of Mlýnky, the computer "Pracovna").
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
            return { s: 200, body: { input: undo[1], undone: false, fields: [{ what: 'Hřibík Pýchavka · birth', field: 'BIRT.DATE', from: '1901', to: '1902' }],
                kept: [{ event: 'E0031', fields: ['BIRT.PLAC'], what: 'Hřibík Pýchavka · birth place', by: 'device', client: { id: 'dv_ipad0000000000000000000000000', name: 'iPad · Safari' } }] } };
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

/** Where the screenshots of the review go (de at 390, 1024 and 1440, light and dark), when asked for: STROM_SHOTS=<folder>. */
type Lang = 'en' | 'de';
const SHOTS = process.env.STROM_SHOTS ?? '';
const shot = (page: Page, name: string): Promise<unknown> => SHOTS ? page.screenshot({ path: `${SHOTS}/d5b-${name}.png` }) : Promise.resolve();

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
    en: {
        actions: (n: string) => `Line actions · ${n}`, up: 'Move up', down: 'Move down', top: 'Move to the top', pause: 'Pause', end: 'End…',
        show: 'Show in tree', workHere: '“Work on this line” (agent) is on Pracovna.', only: 'Only on the computer with the research.',
    },
    de: {
        actions: (n: string) => `Aktionen der Linie · ${n}`, up: 'Nach oben', down: 'Nach unten', top: 'An den Anfang', pause: 'Pausieren', end: 'Beenden…',
        show: 'Im Stammbaum zeigen', workHere: '„An dieser Linie arbeiten“ (Agent) ist auf Pracovna.', only: 'Nur auf dem Computer mit der Forschung.',
    },
} as const;

test.describe('a line\'s actions on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`the ⋯ of a line opens its actions from below (390, ${lang}${dark ? ', dark' : ''})`, async ({ page }) => {
                await paired(page, { lang, width: 390, dark });
                await openOverview(page);
                await unfold(page, 'directions');
                const ov = page.locator('#research-overview');
                const rows = ov.locator('.research-direction--managed');
                await expect(rows).toHaveCount(3);
                // No arrows on the row: the ⋯ of 44 px carries the order.
                await expect(ov.locator('.research-direction__move')).toHaveCount(0);
                // A new line is the computer's.
                await expect(ov.locator('.research-directions__new')).toHaveCount(0);
                const more = rows.nth(2).locator('.research-direction__more');
                const box = await more.boundingBox();
                expect(box!.width).toBeGreaterThanOrEqual(44);
                expect(box!.height).toBeGreaterThanOrEqual(44);
                expect(await overflowing(page, '#research-overview')).toEqual([]);
                expect(await overlapping(page, '#research-overview .research-direction--managed')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `lines-390${dark ? '-dark' : ''}`);

                await more.tap();
                const sheet = page.locator('.bottom-sheet-menu');
                // The quiet sentence after the rows.
                await expect(sheet.locator('.bottom-sheet-item ~ .bottom-sheet-quiet')).toHaveCount(1);
                await expect(sheet).toBeVisible();
                await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText(L[lang].actions('Hřibík a jeho sourozenci'));
                const items = sheet.locator('.bottom-sheet-item .bottom-sheet-label');
                await expect(items).toHaveText([L[lang].up, L[lang].top, L[lang].pause, L[lang].end, L[lang].show].map(t => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)));
                await expect(sheet.locator('.bottom-sheet-quiet')).toHaveText(L[lang].workHere);
                // Through the bridge: no mark of the terminal or the agent.
                await expect(sheet.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
                expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
                expect(await overlapping(page, '.bottom-sheet-menu .bottom-sheet-item')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `line-actions-390${dark ? '-dark' : ''}`);

                // To the top: the new order written through the tunnel.
                await sheet.locator('#device-dir-top').tap();
                await expect.poll(() => scene.writes.map(w => `${w.m} ${w.p}`)).toContain('POST directions/order');
                const order = scene.writes.find(w => w.p === 'directions/order')!;
                expect(bodyOf<{ order: string[] }>(order).order).toEqual(['G0003', 'G0001', 'G0002']);
                await poll(page);
                await expect(rows.first()).toHaveAttribute('data-direction', 'G0003');
            });
        }
    }

    test('Pause and End… through the bridge, the first line without Move up', async ({ page }) => {
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        await unfold(page, 'directions');
        const ov = page.locator('#research-overview');
        await ov.locator('.research-direction--managed[data-direction="G0001"] .research-direction__more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('#device-dir-up')).toHaveCount(0);
        await expect(sheet.locator('#device-dir-top')).toHaveCount(0);
        await expect(sheet.locator('#device-dir-down')).toBeVisible();
        await sheet.locator('#device-dir-pause').tap();
        await expect(sheet).toHaveCount(0);
        await expect.poll(() => scene.writes.filter(w => w.p === 'directions/G0001/state').map(w => bodyOf<{ do: string }>(w).do)).toEqual(['pause']);

        await ov.locator('.research-direction--managed[data-direction="G0002"] .research-direction__more').tap();
        await page.locator('.bottom-sheet-menu #device-dir-end').tap();
        const end = page.locator('#research-direction-end');
        await expect(end).toBeVisible();
        await end.locator('[data-do="done"]').tap();
        await expect.poll(() => scene.writes.filter(w => w.p === 'directions/G0002/state').map(w => bodyOf<{ do: string }>(w).do)).toEqual(['done']);
    });

    test('a 403 device.computer-only takes the ⋯ away with one quiet sentence', async ({ page }) => {
        scene.refuse['POST directions/order'] = { s: 403, body: { code: 'device.computer-only', action: 'directions/order' } };
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        await unfold(page, 'directions');
        const ov = page.locator('#research-overview');
        await ov.locator('.research-direction--managed[data-direction="G0002"] .research-direction__more').tap();
        await page.locator('.bottom-sheet-menu #device-dir-up').tap();
        await expect(page.locator('.toast').filter({ hasText: L.en.only })).toBeVisible();
        await expect(ov.locator('.research-direction__more')).toHaveCount(0);
    });
});

test.describe('a line\'s menu on a computer-wide device', () => {
    test('1440: the ⋯ menu offers no work of the agent', async ({ page }) => {
        await paired(page, { lang: 'de', width: 1440, dark: false });
        await openOverview(page);
        await unfold(page, 'directions');
        const ov = page.locator('#research-overview');
        await ov.locator('.research-direction--managed[data-direction="G0002"] .research-direction__more').click();
        const menu = page.locator('#live-direction-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-do="work"], [data-do="run"]')).toHaveCount(0);
        await expect(menu.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        expect(await overflowing(page, '#research-overview')).toEqual([]);
        await noSideways(page);
        await shot(page, 'line-menu-1440');
    });
});

const P = {
    en: { newN: '2 new', mark: 'new', agent: 'agent', pc: 'from computer Pracovna', ipad: 'from iPad · Safari', from: (n: string) => `from ${n}`,
        send2: 'Send: 2 changes', send1: 'Send: 1 change', undo: 'Undo this send', persons: 'Persons', sources: 'Sources', stories: 'Stories' },
    de: { newN: '2 neu', mark: 'neu', agent: 'Agent', pc: 'vom Computer Pracovna', ipad: 'von iPad · Safari', from: (n: string) => `von ${n}`,
        send2: 'Senden: 2 Änderungen', send1: 'Senden: 1 Änderung', undo: 'Dieses Senden zurücknehmen', persons: 'Personen', sources: 'Quellen', stories: 'Erzählungen' },
} as const;

/** Progress seen on this device until `ms` (the overview's next opening marks what came after). */
async function seenUntil(page: Page, ms: number): Promise<void> {
    await page.evaluate((ms) => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        localStorage.setItem(`strom-device-progress-seen:${id}`, String(ms));
    }, ms);
}

/** Each row of Progress as its time-less text and source. */
async function progressRows(page: Page): Promise<string[]> {
    return page.locator('#research-overview .research-overview__row--device').evaluateAll(rows => rows.map(r => {
        const src = r.querySelector('.research-overview__row-src')?.textContent ?? '';
        const what = r.querySelector('.research-overview__send, .research-change-text, .research-overview__row-text')?.textContent ?? '';
        return `${what.replace(src, '').slice(0, 24)}|${src}|${r.querySelector('.research-overview__new-dot') ? 'dot' : ''}`;
    }));
}

test.describe('Progress on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });
    test.beforeEach(() => {
        scene.log = LOG();
        scene.sends = SENDS;
        scene.actions = ['device.rename', 'device.unpair', 'sync.undo'];
    });

    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`what is new since last seen, each row's source, a send of this device undoable (390, ${lang}${dark ? ', dark' : ''})`, async ({ page }) => {
                await paired(page, { lang, width: 390, dark });
                await seenUntil(page, Date.parse(at(-45)));
                await openOverview(page);
                const ov = page.locator('#research-overview');
                const head = ov.locator('[aria-controls="ov-sec-timeline"]');
                await expect(head).toContainText(P[lang].newN);
                await unfold(page, 'timeline');
                const rows = ov.locator('.research-overview__row--device');
                await expect(rows).toHaveCount(6);
                const me = gw.devices[0].name;
                const t = P[lang];
                const rowsSeen = await progressRows(page);
                expect(rowsSeen.map(r => r.split('|').slice(1).join('|'))).toEqual([
                    `${t.ipad} · ${t.mark}|dot`, `${t.from(me)} · ${t.mark}|dot`, `${t.agent}|`, `${t.ipad}|`, `${t.pc}|`, `${t.agent}|`,
                ]);
                await expect(rows.nth(1).locator('.research-overview__send')).toHaveText(t.send2);
                await expect(rows.nth(3).locator('.research-overview__send')).toHaveText(t.send1);
                // Only this device's own send is offered back; no mark (through the bridge).
                const undo = ov.locator('.research-overview__undo-send');
                await expect(undo).toHaveCount(1);
                await expect(rows.nth(1).locator('.research-overview__undo-send')).toHaveText(t.undo);
                expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                await expect(ov.locator('.research-overview__timeline .research-open-mark, .research-overview__timeline .research-ai-badge')).toHaveCount(0);
                expect(await overflowing(page, '#research-overview')).toEqual([]);
                expect(await overlapping(page, '#research-overview .research-overview__row--device')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') {
                    await ov.locator('.research-overview__timeline').evaluate(e => e.scrollIntoView({ block: 'start' }));
                    await shot(page, `progress-390${dark ? '-dark' : ''}`);
                }
                // The filter: the sends go with Persons.
                await ov.locator('.research-overview__filter[data-filter="sources"]').tap();
                await expect(rows).toHaveCount(1);
                await expect(rows.first().locator('.research-overview__row-src')).toHaveText(t.pc);
                await ov.locator('.research-overview__filter[data-filter="stories"]').tap();
                await expect(rows).toHaveCount(1);
                await ov.locator('.research-overview__filter[data-filter="persons"]').tap();
                await expect(rows).toHaveCount(4);
                await expect(ov.locator('.research-overview__new-dot')).toHaveCount(2);
            });
        }
    }

    test('Undo this send: the fields first, then the undo through the gateway', async ({ page }) => {
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        await unfold(page, 'timeline');
        const ov = page.locator('#research-overview');
        // Never seen before: nothing is marked new.
        await expect(ov.locator('.research-overview__new-dot')).toHaveCount(0);
        await ov.locator('.research-overview__undo-send').tap();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm.locator('#confirm-title')).toHaveText('Undo this send?');
        await expect(confirm.locator('.confirm-list li')).toHaveText(['Hřibík Pýchavka · birth: 1901 → 1902']);
        await expect(confirm.locator('.confirm-list-after')).toHaveText('Only these fields are reverted. Later changes from other devices and from Pracovna stay.');
        expect(scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/sync/I0007/undo {"dry":true}']);
        await noSideways(page);
        await shot(page, 'undo-send-390');
        await confirm.locator('#confirm-ok-btn').tap();
        await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/sync/I0007/undo {"dry":true}', 'device/sync/I0007/undo {}']);
        await poll(page);
        await expect(ov.locator('.research-overview__row--device[data-send="I0007"]')).toHaveCount(0);
        await expect(ov.locator('.research-overview__undo-send')).toHaveCount(0);
    });

    test('a 403 device.computer-only takes Undo this send away; without sync.undo it is not offered', async ({ page }) => {
        scene.refuse['POST device/sync/I0007/undo'] = { s: 403, body: { code: 'device.computer-only', action: 'sync.undo' } };
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        await unfold(page, 'timeline');
        const ov = page.locator('#research-overview');
        await ov.locator('.research-overview__undo-send').tap();
        await expect(page.locator('.toast').filter({ hasText: L.en.only })).toBeVisible();
        await expect(ov.locator('.research-overview__undo-send')).toHaveCount(0);
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    });

    test('seen once, the next opening marks nothing; no Undo when the gateway does not offer it', async ({ page }) => {
        scene.actions = ['device.rename', 'device.unpair'];
        await paired(page, { lang: 'en', width: 390, dark: false });
        await seenUntil(page, Date.parse(at(-45)));
        await openOverview(page);
        await unfold(page, 'timeline');
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__new-dot')).toHaveCount(2);
        await expect(ov.locator('.research-overview__undo-send')).toHaveCount(0);
        await page.evaluate(() => (window.Strom.UI as unknown as { closeResearchOverview(): void }).closeResearchOverview());
        await openOverview(page);
        await unfold(page, 'timeline');
        await expect(ov.locator('.research-overview__row--device')).toHaveCount(6);
        await expect(ov.locator('.research-overview__new-dot')).toHaveCount(0);
    });
});

test.describe('Progress on a wider device', () => {
    for (const width of [1024, 1440]) {
        for (const dark of [false, true]) {
            test(`${width}${dark ? ', dark' : ''}: the rows with their sources, nothing overflows`, async ({ page }) => {
                scene.log = LOG();
                scene.sends = SENDS;
                scene.actions = ['device.rename', 'device.unpair', 'sync.undo'];
                await paired(page, { lang: 'de', width, dark });
                await seenUntil(page, Date.parse(at(-45)));
                await openOverview(page);
                await unfold(page, 'timeline');
                const ov = page.locator('#research-overview');
                await expect(ov.locator('.research-overview__row--device')).toHaveCount(6);
                await expect(ov.locator('.research-overview__new-dot')).toHaveCount(2);
                await expect(ov.locator('.research-overview__undo-send')).toHaveCount(1);
                await ov.locator('.research-overview__timeline').evaluate(e => e.scrollIntoView({ block: 'start' }));
                expect(await overflowing(page, '#research-overview')).toEqual([]);
                expect(await overlapping(page, '#research-overview .research-overview__row--device')).toEqual([]);
                await noSideways(page);
                await shot(page, `progress-${width}${dark ? '-dark' : ''}`);
            });
        }
    }
});
