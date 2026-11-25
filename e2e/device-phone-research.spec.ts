import { test, expect, Page } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * The research on a phone of the home network (spec 094 §4, points 1-3): the
 * More sheet's research group (the state with Send changes, the overview, what
 * waits with its count, the materials, "Add materials…"), the More tab's count
 * of what waits or its dot; the overview as a sheet over the whole screen with
 * only the first section with content open, Now with what is worked on or
 * "Nothing is being worked on now · last …", Stop run through the bridge; an
 * answer in its own sheet, photos taken or from the gallery to a task. Every
 * write goes through the fake gateway's tunnel; a `403 device.computer-only`
 * takes the action away with one quiet sentence, a `409` of an answer says the
 * task changed. Invented data only (the Pýchavkovi of Mlýnky, the computer
 * "Pracovna").
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
const ACCEPTS = { mode: 'research', sync: { auto: 'off' }, sources: true, media: { max: 50 * 1024 * 1024, taskImages: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const FEATURES = ['device.gateway', 'material.list', 'waiting.groups', 'waiting.answer', 'waiting.sent', 'run.lines', 'run.stop'];
const LINE = { id: 'G0001', name: 'Pýchavkovi z Mlýnků po meči', state: 'active', direction: 'ancestors', focus: 'P0003', order: 1, tasks: 3,
    waiting: 0, working: false, since: at(-3000), canStart: false };
const ANSWER = { id: 'T0001', what: 'Kde byl Hřibík pokřtěn – v Mlýnkách, nebo v Lipové?', kind: 'web', actions: ['answer'], at: at(-90), person: 'P0003' };
const IMAGES = { id: 'T0002', what: 'Uložit snímky matriky Mlýnky 1840–1860', kind: 'images', section: 'images', actions: ['answer', 'images'], at: at(-60) };
const RUN = { id: 'run-1a07', research: 'G0001', agent: 'claude', agentName: 'Claude', since: at(-12), state: 'working', session: 'N0142', task: 'T0390',
    lastStep: 'Hledá křest Hřibíka Pýchavky v matrice Mlýnky', sessions: 1 };
const WORKING = { who: 'claude', since: at(-4), task: 'křest Hřibíka Pýchavky', person: 'P0003', research: 'G0001', session: 'N0142', run: 'run-1a07' };

interface Scene {
    waiting: Record<string, unknown>[];
    working: Record<string, unknown>[];
    runs: Record<string, unknown>[];
    runsEnded: Record<string, unknown>[];
    /** Answers of writes by `<method> <path>` (else 200). */
    refuse: Record<string, TunnelReply>;
    /** Every write through the tunnel. */
    writes: DeviceRequest[];
}
let scene: Scene;

function status(device: { id: string; name: string; kind: string }): Record<string, unknown> {
    return {
        ok: true, tree: { id: TREE, name: 'Pýchavkovi z Mlýnků' }, head: HEAD, links: ['send', 'open', 'live', 'app', 'setup', 'chat', 'task'],
        accepts: ACCEPTS, inbox: { trees: [], material: 0 }, lastIntake: null, sends: [], features: FEATURES,
        waiting: scene.waiting, working: scene.working, runs: scene.runs, runsEnded: scene.runsEnded, researches: [LINE], queue: [],
        device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] },
    };
}

function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') return { s: 200, body: status(device) };
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (req.p === 'material') return { s: 200, body: { files: [], batches: [], people: {} } };
    if (req.m === 'GET') return undefined;
    scene.writes.push(req);
    const refused = scene.refuse[`${req.m} ${req.p}`];
    if (refused) return refused;
    if (req.p === 'runs/stop') {
        scene.runs = [];
        scene.working = [];
        scene.runsEnded = [{ ...RUN, ended: at(0), why: 'stopped' }];
        return { s: 200, body: { run: { ...RUN, state: 'stopping' } } };
    }
    if (req.p.startsWith('waiting/')) return { s: 200, body: { ok: true, id: req.p.slice(8), head: HEAD } };
    if (req.p.startsWith('media/')) return { s: 200, body: { task: 'T0002', image: 1, images: [1], by: 'order' } };
    return undefined;
}

let gw: FakeGateway;
test.beforeEach(async () => {
    scene = { waiting: [ANSWER, IMAGES], working: [], runs: [], runsEnded: [], refuse: {}, writes: [] };
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
const shot = (page: Page, name: string): Promise<unknown> => SHOTS ? page.screenshot({ path: `${SHOTS}/d5-${name}.png` }) : Promise.resolve();

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
    await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
}

/** The research's overview opened as the More sheet's row does. */
async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { researchActionOverview(): void }).researchActionOverview());
    await expect(page.locator('#research-overview')).toBeVisible();
}

/** An item of what waits, its group unfolded and its detail open. */
async function openItem(page: Page, id: string) {
    const item = page.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`);
    if (!(await item.isVisible())) await page.locator('#research-overview .research-overview__group-head[aria-expanded="false"]').first().tap();
    await item.locator('.research-overview__waiting-row').tap();
    return item;
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

/** The home-screen icon's line under the toolbar and the overview share no area (the overview's head stays seen). */
async function besideHomeLine(page: Page): Promise<void> {
    const line = page.locator('#device-home-line');
    if (!(await line.isVisible())) return;
    const ov = page.locator('#research-overview');
    if (await ov.evaluate(el => el.classList.contains('research-overview--sheet'))) return;
    expect(overlap(await line.boundingBox(), await ov.boundingBox())).toBe(false);
}

/** Two boxes that share some area. */
function overlap(a: { x: number; y: number; width: number; height: number } | null, b: typeof a): boolean {
    if (!a || !b) return false;
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const L = {
    en: {
        rows: ['Research overview', 'Awaiting action', 'Materials', 'Add materials…'], waiting: 'Awaiting action',
        idle: 'Nothing is being worked on now', last: /^Last worked .+ · line Pýchavkovi z Mlýnků po meči$/, stop: 'Stop run',
        only: 'Only on the computer with the research.', answer: 'Answer', photo: 'Take photo', gallery: 'From gallery', images: 'Add images',
    },
    de: {
        rows: ['Forschungsübersicht', 'Wartet auf Bearbeitung', 'Materialien', 'Materialien hinzufügen…'], waiting: 'Wartet auf Bearbeitung',
        idle: 'Gerade wird nicht gearbeitet', last: /^Zuletzt gearbeitet .+ · Linie Pýchavkovi z Mlýnků po meči$/, stop: 'Lauf stoppen',
        only: 'Nur auf dem Computer mit der Forschung.', answer: 'Antworten', photo: 'Foto aufnehmen', gallery: 'Aus der Galerie', images: 'Bilder hinzufügen',
    },
} as const;

test.describe('the research on a phone of the home network', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const lang of ['en', 'de'] as const) {
        test(`the More sheet's research group and the More tab's count, then its dot (390, ${lang})`, async ({ page }) => {
            await paired(page, { lang, width: 390, dark: false });
            // An edit here the research lacks: the state offers to send it.
            await page.evaluate(() => {
                const dm = window.Strom.DataManager;
                const p = Object.values(dm.getData().persons).find(x => x.firstName === 'Hřibík')!;
                dm.updatePerson(p.id, { firstName: 'Hřibík Josef' });
                window.Strom.UI.refreshActionMenuBadges();
            });
            // What waits, counted on the More tab in the research's colour (over the edit's dot).
            const count = page.locator('#bottom-bar-more-count');
            await expect(count).toHaveClass(/research-count-badge/);
            await expect(count).toHaveText('2');
            await page.locator('#bb-view-more').tap();
            const sheet = page.locator('.bottom-sheet-menu');
            await expect(sheet).toBeVisible();
            // The state with its action first, then the rows in their order (what waits with its count).
            await expect(sheet.locator('#research-sheet-state')).toBeVisible();
            const rows = sheet.locator('[id^="sheet-research-item-"]');
            await expect(rows).toHaveCount(4);
            for (const [i, label] of L[lang].rows.entries()) await expect(rows.nth(i)).toContainText(label);
            await expect(sheet.locator('#sheet-research-item-waiting')).toContainText('2');
            await expect(sheet.locator('#research-sheet-all')).toBeVisible();
            await expect(sheet.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
            expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
            await noSideways(page);
            // Nothing waits: the unsent edits' dot in place of the count.
            await page.keyboard.press('Escape');
            scene.waiting = [];
            await poll(page);
            await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
            await expect(count).toBeHidden();
            await expect(page.locator('#bottom-bar-more-dot')).toBeVisible();
            await expect(page.locator('#bottom-bar-more-dot')).toHaveAttribute('data-signal', 'unsent');
        });
    }

    test('the overview as a sheet: only the first section with content open, Now idle with the last run, then Stop run through the bridge', async ({ page }) => {
        scene.runsEnded = [{ ...RUN, since: at(-120), ended: at(-45), why: 'done' }];
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        // Nothing worked on: the first section with content is what waits, the rest folded.
        await expect(ov.locator('[aria-controls="ov-sec-waiting"]')).toHaveAttribute('aria-expanded', 'true');
        await expect(ov.locator('[aria-controls="ov-sec-now"]')).toHaveAttribute('aria-expanded', 'false');
        await ov.locator('[aria-controls="ov-sec-now"]').tap();
        const idle = ov.locator('.research-overview__idle');
        await expect(idle.locator('.research-overview__idle-title')).toHaveText(L.en.idle);
        await expect(idle.locator('.research-overview__idle-last')).toHaveText(L.en.last);
        // No sentence of a phone without the research (the device reaches it).
        await expect(ov).not.toContainText('only on the computer');
        expect(await overflowing(page, '#research-overview')).toEqual([]);
        await noSideways(page);

        // A run works: Stop run, written through the tunnel.
        scene.working = [WORKING];
        scene.runs = [RUN];
        await poll(page);
        const stop = ov.getByRole('button', { name: L.en.stop }).first();
        await expect(stop).toBeVisible();
        await expect(ov.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await stop.tap();
        await expect.poll(() => scene.writes.filter(w => w.p === 'runs/stop').map(w => typeof w.b === 'string' ? JSON.parse(w.b) : w.b)).toEqual([{ run: 'run-1a07' }]);
        expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
    });

    test('403 device.computer-only: Stop run goes, one quiet sentence says why', async ({ page }) => {
        scene.working = [WORKING];
        scene.runs = [RUN];
        scene.refuse['POST runs/stop'] = { s: 403, body: { ok: false, code: 'device.computer-only', action: 'run.stop' } };
        await paired(page, { lang: 'de', width: 390, dark: true });
        await openOverview(page);
        const ov = page.locator('#research-overview');
        await expect(ov.locator('[aria-controls="ov-sec-now"]')).toHaveAttribute('aria-expanded', 'true');
        await ov.getByRole('button', { name: L.de.stop }).first().tap();
        await expect(page.locator('.toast').filter({ hasText: L.de.only })).toBeVisible();
        await expect(ov.getByRole('button', { name: L.de.stop })).toHaveCount(0);
        // One sentence only: no refusal under the run beside it.
        await expect(ov.getByText('Der Agent wurde nicht gestoppt', { exact: false })).toHaveCount(0);
        expect(scene.writes.filter(w => w.p === 'runs/stop')).toHaveLength(1);
        // The toast in full (its fade-in done) on the shot.
        await expect.poll(() => page.locator('.toast').filter({ hasText: L.de.only }).evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        await shot(page, 'computer-only-390-dark');
    });

    test('an answer in its own sheet through the bridge; a 409 says the task changed; Take photo / From gallery to a task', async ({ page }) => {
        await paired(page, { lang: 'en', width: 390, dark: false });
        await openOverview(page);
        const ov = page.locator('#research-overview');
        const item = await openItem(page, 'T0001');
        await item.locator('[data-action="answer"]').tap();
        const sheet = page.locator('#waiting-answer-sheet');
        await expect(sheet).toBeVisible();
        // A question without images: no photos beside its answer.
        await expect(sheet.locator('.waiting-upload__capture')).toHaveCount(0);
        scene.refuse['POST waiting/T0001'] = { s: 409, body: { ok: false, code: 'waiting.changed', at: at(-1), what: ANSWER.what } };
        await sheet.locator('textarea').fill('V Lipové, podle zápisu faráře z roku 1852.');
        await sheet.locator('.waiting-answer-sheet__send').tap();
        await expect(sheet.locator('.waiting-answer-changed')).toBeVisible();
        delete scene.refuse['POST waiting/T0001'];
        await sheet.locator('.waiting-answer-sheet__send').tap();
        await expect(sheet).toHaveCount(0);
        const answers = scene.writes.filter(w => w.p === 'waiting/T0001').map(w => (typeof w.b === 'string' ? JSON.parse(w.b) : w.b).do);
        expect(answers).toEqual(['answer', 'answer']);

        // Images to a task: Take photo (the camera) and From gallery, the file through the tunnel with its task.
        const img = await openItem(page, 'T0002');
        await img.locator('[data-action="images"]').tap();
        const pair = img.locator('.waiting-upload__capture');
        await expect(pair.getByRole('button')).toHaveText([L.en.photo, L.en.gallery]);
        const boxes = await pair.getByRole('button').evaluateAll(bs => bs.map(b => b.getBoundingClientRect().height));
        for (const h of boxes) expect(h).toBeGreaterThanOrEqual(44);
        const chooser = page.waitForEvent('filechooser');
        await pair.getByRole('button', { name: L.en.photo }).tap();
        const fc = await chooser;
        expect(await fc.element().getAttribute('capture')).toBe('environment');
        expect(await fc.element().getAttribute('accept')).toContain('image/');
        await fc.setFiles({ name: 'matrika-mlynky-1852.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]) });
        await img.locator('.waiting-upload__send').tap();
        await expect.poll(() => scene.writes.filter(w => w.m === 'PUT' && w.p.startsWith('media/')).length).toBe(1);
        const put = scene.writes.find(w => w.m === 'PUT')!;
        expect(Object.entries(put.h ?? {}).find(([k]) => k.toLowerCase() === 'x-strom-task')?.[1]).toBe('T0002');
        expect(gw.requests.filter(r => r.includes('/__device/'))).toEqual([]);
    });

    test('the answer\'s sheet of an item that takes images offers the photos too', async ({ page }) => {
        await paired(page, { lang: 'de', width: 360, dark: false });
        await openOverview(page);
        const img = await openItem(page, 'T0002');
        await img.locator('[data-action="answer"]').tap();
        const sheet = page.locator('#waiting-answer-sheet');
        await expect(sheet.locator('.waiting-upload__capture').getByRole('button')).toHaveText([L.de.photo, L.de.gallery]);
        // Nothing to cancel before a photo is chosen (the sheet has its own Cancel).
        await expect(sheet.locator('.waiting-upload__cancel')).toHaveCount(0);
        expect(await overflowing(page, '#waiting-answer-sheet')).toEqual([]);
        await noSideways(page);
        await shot(page, 'answer-photos-360');
    });
});

test.describe('the research on a device at every width, light and dark', () => {
    test.use({ hasTouch: true, isMobile: true });
    for (const lang of ['en', 'de'] as const) {
        for (const width of [360, 390, 768, 1024]) {
            for (const dark of [false, true]) {
                test(`${lang} ${width}${dark ? ' dark' : ''}: the More sheet and the overview, nothing past the edge`, async ({ page }) => {
                    scene.working = [WORKING];
                    scene.runs = [RUN];
                    await paired(page, { lang, width, dark });
                    await page.locator('#bb-view-more').tap();
                    const sheet = page.locator('.bottom-sheet-menu');
                    await expect(sheet).toBeVisible();
                    await expect(sheet.locator('#sheet-research-item-overview')).toBeVisible();
                    expect(await overflowing(page, '.bottom-sheet-menu')).toEqual([]);
                    await noSideways(page);
                    if (lang === 'de' && (width === 390 || width === 1024)) {
                        await shot(page, `more-${width}${dark ? '-dark' : ''}`);
                    }
                    await sheet.locator('#sheet-research-item-overview').tap();
                    const ov = page.locator('#research-overview');
                    await expect(ov).toBeVisible();
                    await expect(ov.getByRole('button', { name: L[lang].stop }).first()).toBeVisible();
                    expect(await overflowing(page, '#research-overview')).toEqual([]);
                    await noSideways(page);
                    // The overview's head and its first button share no area.
                    const stop = await ov.getByRole('button', { name: L[lang].stop }).first().boundingBox();
                    const head = await ov.locator('.research-overview__head, .research-overview__header').first().boundingBox().catch(() => null);
                    expect(overlap(stop, head)).toBe(false);
                    await besideHomeLine(page);
                    if (lang === 'de' && (width === 390 || width === 1024)) {
                        await shot(page, `overview-${width}${dark ? '-dark' : ''}`);
                    }
                });
            }
        }
    }
});

test.describe('the research on a computer-wide device (a notebook\'s browser), light and dark', () => {
    for (const lang of ['en', 'de'] as const) {
        for (const dark of [false, true]) {
            test(`${lang} 1440${dark ? ' dark' : ''}: the research menu and the overview, nothing past the edge`, async ({ page }) => {
                scene.working = [WORKING];
                scene.runs = [RUN];
                await paired(page, { lang, width: 1440, dark });
                await page.locator('#research-menu-btn').click();
                const menu = page.locator('#research-menu');
                await expect(menu).toBeVisible();
                await expect(menu.locator('#research-item-overview')).toBeVisible();
                expect(await overflowing(page, '#research-menu')).toEqual([]);
                await noSideways(page);
                if (lang === 'de') await shot(page, `menu-1440${dark ? '-dark' : ''}`);
                await menu.locator('#research-item-overview').click();
                const ov = page.locator('#research-overview');
                await expect(ov).toBeVisible();
                await expect(ov.getByRole('button', { name: L[lang].stop }).first()).toBeVisible();
                expect(await overflowing(page, '#research-overview')).toEqual([]);
                await noSideways(page);
                await besideHomeLine(page);
                if (lang === 'de') await shot(page, `overview-1440${dark ? '-dark' : ''}`);
            });
        }
    }
});
