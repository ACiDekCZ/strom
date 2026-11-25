import { test, expect, Page } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * A person's conflict and hypothesis on a phone of the home network (spec 094
 * §4, 4.8): the conflict's panel from below with the two values one under the
 * other, Keep / Take across the width (44 px), what each does, "More in What
 * the research knows ›", no "Leave it to the agent" and no terminal sentence;
 * decided through the gateway's `device/conflict/<X>` (`{take}`), a hypothesis
 * through `device/hypothesis/<H>` with the app link's choices. Announced by
 * `status.device.actions` only; `409 *.gone` and `403 device.computer-only`
 * answered. Invented data only (the Pýchavkovi of Mlýnky, the computer "Pracovna").
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
    '1 _STROM_HYPO H0031', '2 TITL Otec Hřibíka: Bonifác, nebo jeho bratr z Mährisch-Schönberg?', '2 STAT open', '2 _PICK Y',
    '2 _VAR A', '3 TITL Syn Bonifáce a Holubinky', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@', '4 _PAR @P0002@',
    '2 _VAR B', '3 TITL Otec neznámý',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 @S0001@ SOUR', '1 TITL Matrika narozených Mlýnky 1895–1910', '1 REFN S0001', '1 _STROM_READ research',
    '0 TRLR',
].join('\n');
const ACCEPTS = { mode: 'research', sync: { auto: 'off' }, sources: true, media: { max: 50 * 1024 * 1024, taskImages: true, tasks: 'open' } };
const FEATURES = ['hypothesis.decide.link', 'device.gateway', 'material.list', 'waiting.groups', 'waiting.answer', 'waiting.sent', 'run.lines', 'run.stop'];
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
    /** Conflicts and hypotheses decided at the research (a second ask: 409 *.gone). */
    decided: Set<string>;
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
    const decide = /^device\/(conflict|hypothesis)\/([XH]\d+)$/.exec(req.p);
    if (decide) {
        if (scene.decided.has(decide[2])) return { s: 409, body: { code: `${decide[1]}.gone` } };
        scene.decided.add(decide[2]);
        return { s: 200, body: decide[1] === 'conflict' ? { decided: decide[2], take: bodyOf<{ take: string }>(req).take, head: HEAD } : { decided: decide[2], head: HEAD } };
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
    scene = { researches: LINES(), actions: ['device.rename', 'device.unpair'], refuse: {}, writes: [], log: [], sends: () => [], decided: new Set() };
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


const panel = (page: Page) => page.locator('#prc-panel');
const choice = (page: Page, which: 'user' | 'research') => panel(page).locator(`.prc-panel-row[data-side="${which}"] .prc-panel-choice`);
const hypo = (page: Page, id: string) => page.locator(`#person-research-modal .person-research-hypo[data-hypo="${id}"]`);

/** Hřibík's edit form, its birth's conflict panel open from the tag. */
async function openConflict(page: Page): Promise<void> {
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hřibík')!;
        window.Strom.UI.runPersonMenuAction(p.id, 'edit');
    });
    await expect(page.locator('#person-modal')).toBeVisible();
    const tag = page.locator('#person-modal .pm-conflict-tag[data-field="input-birthdate"]');
    await tag.scrollIntoViewIfNeeded();
    await tag.tap();
    await expect(panel(page)).toBeVisible();
}

const C = {
    en: { keep: 'Keep', take: 'Take', more: 'More in What the research knows ›', only: 'Only on the computer with the research.', decided: 'Decided in the research.', gone: 'Already decided in the research.' },
    de: { keep: 'Behalten', take: 'Übernehmen', more: 'Mehr in Was die Forschung weiß ›', only: 'Nur auf dem Computer mit der Forschung.', decided: 'In der Forschung entschieden.', gone: 'In der Forschung bereits entschieden.' },
} as const;

test.describe('a person\'s conflict on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`the panel from below, decided through the gateway (390, ${lang}${dark ? ', dark' : ''})`, async ({ page }) => {
                scene.actions = ['device.rename', 'device.unpair', 'conflict.decide', 'hypothesis.decide'];
                await paired(page, { lang, width: 390, dark });
                await openConflict(page);
                const p = panel(page);
                await expect(p).toHaveClass(/prc-panel--sheet/);
                // The values one under the other, the choices across the width (44 px).
                const [user, research] = [await choice(page, 'user').boundingBox(), await choice(page, 'research').boundingBox()];
                const box = (await p.boundingBox())!;
                expect(research!.y).toBeGreaterThan(user!.y + user!.height);
                for (const b of [user!, research!]) {
                    expect(b.height).toBeGreaterThanOrEqual(44);
                    expect(b.width).toBeGreaterThan(box.width * 0.75);
                }
                await expect(p.locator('.prc-panel-note')).toHaveCount(2);
                await expect(p.locator('.prc-panel-more')).toBeVisible();
                // No agent, no terminal: neither its sentence nor a mark.
                await expect(p.locator('.prc-notice')).toHaveCount(0);
                await expect(p.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
                await expect(p.locator('.prc-link-note')).toHaveCount(0);
                expect(await overflowing(page, '#prc-panel')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `conflict-390${dark ? '-dark' : ''}`);
                await choice(page, 'user').tap();
                await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/conflict/X0007 {"take":"user"}']);
            });
        }
    }

    test('a conflict decided meanwhile (409 conflict.gone) reads as decided elsewhere: the panel and its tag go', async ({ page }) => {
        scene.actions = ['device.rename', 'device.unpair', 'conflict.decide'];
        scene.decided.add('X0007');
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openConflict(page);
        await choice(page, 'research').tap();
        await expect.poll(() => scene.writes.map(w => w.p)).toEqual(['device/conflict/X0007']);
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('#person-modal .pm-conflict-tag')).toHaveCount(0);
    });

    test('without conflict.decide: the values only, one quiet sentence', async ({ page }) => {
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openConflict(page);
        const p = panel(page);
        await expect(p.locator('.prc-panel-choice')).toHaveCount(0);
        await expect(p.locator('.prc-notice-text')).toHaveText(C.en.only);
        await expect(p).not.toContainText('terminal');
    });

    test('a 403 device.computer-only takes the choices away', async ({ page }) => {
        scene.actions = ['device.rename', 'device.unpair', 'conflict.decide'];
        scene.refuse['POST device/conflict/X0007'] = { s: 403, body: { code: 'device.computer-only', action: 'conflict.decide' } };
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openConflict(page);
        await choice(page, 'user').tap();
        await expect(page.locator('.toast').filter({ hasText: C.en.only })).toBeVisible();
        await expect(panel(page).locator('.prc-panel-choice')).toHaveCount(0);
    });
});

test.describe('a person\'s hypothesis on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    async function openKnows(page: Page): Promise<void> {
        await page.evaluate(() => {
            const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hřibík')!;
            window.Strom.UI.runPersonMenuAction(p.id, 'research-knows');
        });
        await expect(page.locator('#person-research-modal')).toBeVisible();
    }

    for (const lang of ['en', 'de'] as const) {
        test(`a version and No version holds through the gateway, no mark, no Reopen (390, ${lang})`, async ({ page }) => {
            scene.actions = ['device.rename', 'device.unpair', 'hypothesis.decide'];
            await paired(page, { lang, width: 390, dark: false });
            await openKnows(page);
            const card = hypo(page, 'H0031');
            await card.scrollIntoViewIfNeeded();
            await expect(card.locator('.prv-pick')).toHaveCount(2);
            await expect(card.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
            await expect(card.locator('[data-hypo-act="reopen"]')).toHaveCount(0);
            expect(await overflowing(page, '#person-research-modal')).toEqual([]);
            await noSideways(page);
            if (lang === 'de') await shot(page, 'hypothesis-390');
            await card.locator('.person-research-variant[data-variant="A"] .prv-pick').tap();
            await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/hypothesis/H0031 {"variant":"A"}']);
            await expect(page.locator('.toast').filter({ hasText: C[lang].decided })).toBeVisible();
            await card.locator('[data-hypo-act="abandon"]').tap();
            await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toContain('device/hypothesis/H0031 {"abandon":true}');
            await expect(page.locator('.toast').filter({ hasText: C[lang].gone })).toBeVisible();
        });
    }

    test('without hypothesis.decide the versions are not offered', async ({ page }) => {
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openKnows(page);
        await expect(hypo(page, 'H0031').locator('.prv-pick')).toHaveCount(0);
        await expect(hypo(page, 'H0031').locator('[data-hypo-act]')).toHaveCount(0);
    });
});

test.describe('a person\'s conflict on a wider device', () => {
    for (const [width, dark] of [[1024, true], [1440, false]] as const) {
        test(`${width}${dark ? ', dark' : ''}: the panel at its tag, decided through the gateway`, async ({ page }) => {
            scene.actions = ['device.rename', 'device.unpair', 'conflict.decide'];
            await paired(page, { lang: 'de', width, dark });
            await page.evaluate(() => {
                const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hřibík')!;
                window.Strom.UI.runPersonMenuAction(p.id, 'edit');
            });
            await page.locator('#person-modal .pm-conflict-tag[data-field="input-birthdate"]').click();
            await expect(panel(page)).toBeVisible();
            await expect(panel(page).locator('.prc-notice, .research-open-mark, .research-ai-badge, .prc-link-note')).toHaveCount(0);
            expect(await overflowing(page, '#prc-panel')).toEqual([]);
            await noSideways(page);
            await shot(page, `conflict-${width}${dark ? '-dark' : ''}`);
            await choice(page, 'research').click();
            await expect.poll(() => scene.writes.map(w => `${w.p} ${JSON.stringify(bodyOf(w))}`)).toEqual(['device/conflict/X0007 {"take":"research"}']);
        });
    }
});
