import { test, expect, Page } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { fakeBridge, openResearch, poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * Several devices of the home network (spec 094 §9) and a second computer
 * (§8): each line of the research's changes says where it came from (a
 * device by its name, the computer by its name, the agent), a conflict
 * between the sends of two devices offers "Keep from iPhone" / "Keep from
 * iPad" with the time of each send, the Connection says how many other
 * devices are connected now, the research's actions offer "Undo send…" when
 * the gateway allows it, and on a computer with a mouse the overview stands
 * as a panel beside the tree. Every request goes through the fake gateway.
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
    '1 BIRT', '2 DATE 1901',
    '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 _STROM_TAKE Y',
    '2 VAL 3 FEB 1902', '3 SOUR @S0001@', '3 _STROM_SIDE research', '2 VAL 1901', '3 _STROM_SIDE user',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 @S0001@ SOUR', '1 TITL Matrika narozených Mlýnky 1895–1910', '1 REFN S0001', '1 _STROM_READ research',
    '0 TRLR',
].join('\n');
const ACCEPTS = { mode: 'research', sync: { auto: 'off' }, sources: true, media: { max: 50 * 1024 * 1024, taskImages: true, tasks: 'open' } };
const FEATURES = ['device.gateway', 'material.list', 'waiting.groups', 'waiting.answer', 'waiting.sent', 'run.lines', 'run.stop'];
const CAPS = { directionsWrite: true, directionsOrder: true, orderMode: 'weight', directionKinds: ['ancestors', 'descendants', 'question'], duplicateDirections: false, offLineBranches: false };
const LINES = [
    { id: 'G0001', name: 'Pýchavkovi z Mlýnků po meči', state: 'active', direction: 'ancestors', focus: 'P0003', order: 1, tasks: 3, waiting: 0, working: false, since: at(-3000), canStart: false },
];
const IPAD = { id: 'dv_ipad0000000000000000000000000', name: 'iPad · Safari' };
const IPHONE = { id: 'dv_iphone000000000000000000000', name: 'iPhone · Safari' };
/** A browser of the computer (not a device of the gateway): on a device it is the computer. */
const PC_BROWSER = { id: 'cl_pracovna', name: 'Firefox · macOS' };

interface Scene {
    actions: string[];
    /** Other devices connected now (`status.device.others`; absent: not said). */
    others?: number;
    writes: DeviceRequest[];
}
let scene: Scene;

const bodyOf = <B>(req: DeviceRequest): B => (typeof req.b === 'string' ? JSON.parse(req.b) : req.b ?? {}) as B;

/** The research's history: a device's line, the agent's, one from the computer's browser. */
const LOG = [
    { head: 'a5', at: at(-5), what: ['~P0003'], text: ['Hřibík Pýchavka: birth 1902 in Mlýnky'], kinds: ['person'], task: '', via: IPAD },
    { head: 'a4', at: at(-60), what: ['~P0002'], text: ['Holubinka Ryzcová: marriage 1899 in Lipová, record of the parish of Mährisch-Schönberg'], kinds: ['person'], task: 'T0012' },
    { head: 'a3', at: at(-120), what: ['+S0031'], text: ['Register of births Mlýnky 1895–1910'], kinds: ['source'], task: '', via: PC_BROWSER },
];

/** This device's send (it met the conflict X0007) and the iPad's earlier one (its value stands in the research). */
const SENDS = (device: { id: string; name: string }): Record<string, unknown>[] => [
    { intake: 'in7', at: at(-30), state: 'written', changes: 2, input: 'I0007', client: { id: device.id, name: device.name }, conflicts: ['X0007'] },
    { intake: 'in6', at: at(-90), state: 'written', changes: 1, input: 'I0006', client: IPAD },
];

function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') {
        return { s: 200, body: {
            ok: true, tree: { id: TREE, name: 'Pýchavkovi z Mlýnků' }, head: HEAD, links: ['send', 'open', 'live', 'app', 'setup', 'chat', 'task'],
            accepts: ACCEPTS, inbox: { trees: [], material: 0 }, lastIntake: null, sends: SENDS(device), features: FEATURES, caps: CAPS,
            waiting: [], working: [], runs: [], runsEnded: [], researches: LINES, queue: [],
            device: { id: device.id, name: device.name, kind: device.kind, actions: scene.actions, ...(scene.others !== undefined ? { others: scene.others } : {}) },
        } };
    }
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (req.p === 'material') return { s: 200, body: { files: [], batches: [], people: {} } };
    if (req.p === 'log') return { s: 200, body: { entries: LOG } };
    if (req.m === 'GET') return undefined;
    scene.writes.push(req);
    const undo = /^device\/sync\/(I\d+)\/undo$/.exec(req.p);
    if (undo) {
        if (bodyOf<{ dry?: boolean }>(req).dry) {
            return { s: 200, body: { input: undo[1], undone: 1, fields: [
                { what: 'Birth – Hřibík Pýchavka', field: 'date', from: '3 APR 1902', to: '1902', event: 'E0031', person: 'P0003' },
            ], kept: [] } };
        }
        return { s: 200, body: { input: undo[1], undone: true, fields: [] } };
    }
    return undefined;
}

let gw: FakeGateway;
test.beforeEach(async () => {
    scene = { actions: ['device.rename', 'device.unpair', 'conflict.decide', 'sync.undo'], others: 2, writes: [] };
    gw = await startDeviceGateway();
    gw.trees = [{ id: TREE, name: 'Pýchavkovi z Mlýnků', archive: false }];
    gw.onTunnel = bridge;
    gw.clockOffsetMs = T.getTime() - Date.now();
});
test.afterEach(async () => {
    await gw.close();
});

type Lang = 'en' | 'de';
const SHOTS = process.env.STROM_SHOTS ?? '';
const shot = (page: Page, name: string): Promise<unknown> => SHOTS ? page.screenshot({ path: `${SHOTS}/d7b-${name}.png`, animations: 'disabled' }) : Promise.resolve();

/** Paired from the gateway's QR code, the research's tree loaded through it; the conflict's two sends remembered as a send's answer named them. */
async function paired(page: Page, opts: { lang: Lang; width: number; dark: boolean }, earlier: { id: string; name: string } = IPAD): Promise<void> {
    await page.clock.setFixedTime(T);
    await page.setViewportSize({ width: opts.width, height: opts.width < 641 ? 780 : opts.width <= 1024 ? 768 : 900 });
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
    await page.evaluate(({ later, earlier }) => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({
            modeAsked: true, skipPreview: true, placesOffer: 'done',
            conflictSent: [{ id: 'X0007', earlier: { ...earlier, input: 'I0006' }, later }],
        }));
    }, { later: IPHONE, earlier });
    if (opts.lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await poll(page);
}

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

/** Pairs of `sel`'s elements whose boxes share area. */
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

/** The research's actions: the More sheet's "All research actions" on a phone and a tablet, the menu's Other actions on a computer. */
async function researchActions(page: Page): Promise<string> {
    if (!await page.locator('#research-menu-btn').isVisible()) {
        await page.locator('#bb-view-more').click();
        await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
        await page.locator('#research-sheet-all').click();
        await expect(page.locator('#research-sheet-menu')).toBeVisible();
        return '#research-sheet-menu';
    }
    await page.locator('#research-menu-btn').click();
    await expect(page.locator('#research-menu')).toBeVisible();
    await page.locator('#research-item-more').click();
    await expect(page.locator('#research-menu-more')).toBeVisible();
    return '#research-menu';
}

/** The Connection: the sheet on a phone, the dropdown's top block wider. */
async function openConnection(page: Page): Promise<string> {
    if (page.viewportSize()!.width <= 640) {
        await page.locator('#current-tree-conn').click();
        await expect(page.locator('.device-conn-sheet')).toBeVisible();
        return '.device-conn-sheet';
    }
    await page.locator('.tree-switcher-btn').click();
    await page.locator('#tree-switcher-conn-top').click();
    await expect(page.locator('#device-conn-modal')).toBeVisible();
    return '#device-conn-modal';
}

const L = {
    en: {
        from: ['from iPad · Safari', 'agent', 'from computer Pracovna'], keep: ['Keep from iPhone', 'Keep from iPad'], keepPc: 'Keep from Pracovna',
        sent: /^sent .*\d{1,2}:\d{2}/, others: '2 more devices connected', undo: 'Undo send…', ask: 'Undo this send?',
    },
    de: {
        from: ['von iPad · Safari', 'Agent', 'vom Computer Pracovna'], keep: ['Von iPhone behalten', 'Von iPad behalten'], keepPc: 'Von Pracovna behalten',
        sent: /^gesendet .*\d{1,2}:\d{2}/, others: 'Noch 2 Geräte verbunden', undo: 'Senden zurücknehmen…', ask: 'Dieses Senden zurücknehmen?',
    },
} as const;

const SIZES = [[390, false], [390, true], [1024, false], [1024, true], [1440, false], [1440, true]] as const;

for (const [width, dark] of SIZES) {
    test.describe(`several devices at ${width}${dark ? ', dark' : ''}`, () => {
        if (width <= 640) test.use({ hasTouch: true, isMobile: true });
        for (const lang of ['en', 'de'] as const) {
            test(`${lang}: the sources of the changes, a conflict of two devices, the devices connected, Undo send…`, async ({ page }) => {
                const t = L[lang];
                const sfx = `${lang}-${width}${dark ? '-dark' : ''}`;
                await paired(page, { lang, width, dark });

                // Following live (a tablet's and a computer's panel; a phone's strip opens Progress, which says it too):
                // each change says its source (a device, the agent, the computer by its name).
                if (width > 640) {
                    await page.evaluate(() => (window.Strom.UI as unknown as { researchActionLive(): void }).researchActionLive());
                    const live = page.locator('#live-panel');
                    await expect(live).toBeVisible();
                    const rows = live.locator('.live-changes > li');
                    await expect(rows).toHaveCount(3);
                    await expect(rows.locator('.research-change-via')).toHaveText([...t.from]);
                    await expect(rows.first()).toBeVisible();
                    await expect(live.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
                    expect(await overflowing(page, '#live-panel')).toEqual([]);
                    expect(await overlapping(page, '#live-panel .live-changes > li')).toEqual([]);
                    await noSideways(page);
                    if (lang === 'de') await shot(page, `sources-${sfx}`);
                    await page.evaluate(() => (window.Strom.UI as unknown as { researchActionStop(): void }).researchActionStop());
                }

                // A conflict between this device's send and the iPad's: each choice names its device, each side its send's time.
                await page.evaluate(() => {
                    const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hřibík')!;
                    window.Strom.UI.runPersonMenuAction(p.id, 'research-knows');
                });
                const card = page.locator('#person-research-modal [data-conflict-card="X0007"]');
                await card.scrollIntoViewIfNeeded();
                await expect(card.locator('.prc-choice')).toHaveText([...t.keep]);
                const sent = (which: 'user' | 'research') => card.locator(`.prc-side[data-side="${which}"] .prc-meta`).filter({ hasText: t.sent });
                await expect(sent('user')).toHaveCount(1);
                await expect(sent('research')).toHaveCount(1);
                expect(await sent('user').textContent()).not.toBe(await sent('research').textContent());
                expect(await overflowing(page, '#person-research-modal')).toEqual([]);
                expect(await overlapping(page, '#person-research-modal [data-conflict-card="X0007"] .prc-choice')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `conflict-${sfx}`);
                await page.keyboard.press('Escape');
                await expect(page.locator('#person-research-modal')).toBeHidden();

                // The Connection says how many other devices are connected now.
                const conn = await openConnection(page);
                await expect(page.locator(`${conn} .device-conn-me .device-conn-others`)).toHaveText(t.others);
                expect(await overflowing(page, conn)).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `connection-${sfx}`);
                await page.evaluate(() => (window.Strom.UI as unknown as { closeDeviceConnection(): void }).closeDeviceConnection());
                await expect(page.locator('.device-conn')).toHaveCount(0);

                // "Undo send…" among the research's actions, without a mark; it asks first, through the gateway.
                const menu = await researchActions(page);
                const item = page.locator(`${menu} #research-item-undo-this`);
                await expect(item).toHaveText(t.undo);
                await expect(item.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
                expect(await overflowing(page, menu)).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `undo-row-${sfx}`);
                await item.click();
                const confirm = page.locator('#confirmation-modal');
                await expect(confirm.locator('#confirm-title')).toHaveText(t.ask);
                await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/sync/I0007/undo {"dry":true}']);
                await confirm.locator('#confirm-ok-btn').click();
                await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/sync/I0007/undo {"dry":true}', 'device/sync/I0007/undo {}']);
            });
        }
    });
}

test.describe('several devices, what is not said', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('a conflict with a send of the computer\'s browser keeps "from Pracovna"; no count of devices, no Undo send… without sync.undo', async ({ page }) => {
        scene.actions = ['device.rename', 'device.unpair', 'conflict.decide'];
        scene.others = undefined;
        await paired(page, { lang: 'en', width: 390, dark: false }, PC_BROWSER);
        await page.evaluate(() => {
            const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hřibík')!;
            window.Strom.UI.runPersonMenuAction(p.id, 'research-knows');
        });
        const card = page.locator('#person-research-modal [data-conflict-card="X0007"]');
        await card.scrollIntoViewIfNeeded();
        await expect(card.locator('.prc-choice')).toHaveText(['Keep from iPhone', L.en.keepPc]);
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toBeHidden();

        const conn = await openConnection(page);
        await expect(page.locator(`${conn} .device-conn-me .device-conn-name`)).toBeVisible();
        await expect(page.locator(`${conn} .device-conn-others`)).toHaveCount(0);
        await page.evaluate(() => (window.Strom.UI as unknown as { closeDeviceConnection(): void }).closeDeviceConnection());

        const menu = await researchActions(page);
        await expect(page.locator(`${menu} #research-item-live`)).toBeVisible();
        await expect(page.locator(`${menu} #research-item-undo-this`)).toHaveCount(0);
    });
});

test.describe('a second computer with a mouse (1440)', () => {
    for (const dark of [false, true]) {
        test(`the overview stands as a panel beside the tree${dark ? ', dark' : ''}`, async ({ page }) => {
            await paired(page, { lang: 'de', width: 1440, dark });
            await page.evaluate(() => (window.Strom.UI as unknown as { researchActionOverview(): void }).researchActionOverview());
            const ov = page.locator('#research-overview');
            await expect(ov).toBeVisible();
            await expect(ov).toHaveClass(/research-overview--docked/);
            await expect(ov).not.toHaveClass(/research-overview--sheet/);
            // The tree stays beside it.
            await expect(page.locator('.person-card', { hasText: 'Hřibík' }).first()).toBeVisible();
            expect(await overflowing(page, '#research-overview')).toEqual([]);
            await noSideways(page);
            await shot(page, `overview-1440${dark ? '-dark' : ''}`);
        });
    }
});

test.describe('the computer with the gateway', () => {
    test('a line of the overview written by a device\'s send says the device; the agent\'s says agent', async ({ page }) => {
        await page.clock.setFixedTime(T);
        await openResearch(page);
        await fakeBridge(page, {
            features: ['device.gateway'],
            sends: [{ intake: 'R3', at: at(-2), state: 'written', changes: 1, tree: 'other-app-tree', sent: 'x', client: IPHONE }],
            log: [
                { head: 'h3', at: at(-2), what: ['+P0004 Ludmila /Fíšková/'], task: '', via: IPHONE },
                { head: 'h1', at: at(-6), what: ['+P0006 Karel /Fíšek/'], task: 'T0003' },
            ],
        });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        const rows = ov.locator('li').filter({ hasText: /Ludmila|Karel/ });
        await ov.getByText('Other changes', { exact: true }).click();
        await expect(rows.filter({ hasText: 'Ludmila' }).locator('.research-change-via')).toHaveText('from iPhone · Safari');
    });
});
