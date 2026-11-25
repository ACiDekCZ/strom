import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, fakeGlance, fakeFinds, type FakeGateway, type TunnelReply } from './device-gateway.js';

/**
 * A phone's Research screen (spec 094 K3.13, §1, §7, §8 points 6–7) through
 * the fake gateway: on a phone paired with a research that gives the screen's
 * data (`glance`), the start ends on the Research screen and the tree is never
 * asked for (`tree.ged`); Family downloads it with its progress over the dock
 * (Cancel: the screen stays), then the tree; Back returns to the screen, the
 * tree kept (Family again opens it at once). Held sideways the screen has two
 * columns, each scrolled on its own. A tablet is as before: the tree opens at
 * the start, no Research screen. Invented data only (the Pýchavkovi of
 * Mlýnky, the computer Pracovna). `STROM_SHOTS_DIR` set: screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const NAME = 'Pýchavkovi z Mlýnků';

function ged(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 25 NOV 2026', `1 _STROM_TREE ${PYCH}`, '1 _STROM_HEAD 3c7a9e1f05b2',
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Jan /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Josef /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

interface Asked {
    /** Every `tree.ged` asked. */
    trees: number;
    /** Every `glance` asked. */
    glances: number;
}

/** One tree of a research that gives the Research screen's data. `hold`: the next `tree.ged` waits for it. */
function research(gw: FakeGateway, o: { hold?: Promise<void> } = {}): Asked {
    gw.trees = [{ id: PYCH, name: NAME, archive: false }];
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    gw.glance = fakeGlance({ id: PYCH, name: NAME });
    gw.finds = (_tree: string, q: Record<string, string>) => fakeFinds(q.since);
    const asked: Asked = { trees: 0, glances: 0 };
    let hold = o.hold;
    gw.onTunnel = async (req): Promise<TunnelReply | undefined> => {
        if (req.p === 'glance') asked.glances++;
        if (req.p === 'tree.ged') {
            asked.trees++;
            if (hold) {
                const h = hold;
                hold = undefined;
                await h;
            }
            return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged() };
        }
        return undefined;
    };
    return asked;
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

const screen = (page: Page) => page.locator('#phone-research');
const loadToast = (page: Page) => page.locator('.toast[data-kind="tree-load"]');
const josef = (page: Page) => page.locator('#tree-container .person-card', { hasText: 'Josef' }).first();

/** Paired on a phone: the Research screen, the start screen gone. */
async function pairedOnScreen(page: Page, gw: FakeGateway): Promise<void> {
    await page.goto(gw.pairCode().url);
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 20000 });
    await expect(screen(page)).toBeVisible({ timeout: 15000 });
}

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test.describe('en', () => {
    test.use({ locale: 'en-US' });

    test('a phone: paired, the Research screen, the tree never asked for; its bar Research | Family | (+) | Table | More', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw);
        await pairedOnScreen(page, gw);
        // The sections in their order, the research's data read.
        await expect.poll(() => asked.glances, { timeout: 10000 }).toBeGreaterThan(0);
        const titles = screen(page).locator('.phone-sec:not([hidden]) .phone-sec__title');
        await expect(titles).toHaveText(['Now', 'Waiting · 1', 'Finds', 'Lines · in the order of work']);
        await expect(screen(page).locator('.phone-research__more')).toHaveText('Progress and queue');
        await expect(screen(page).locator('.phone-dock__note')).toHaveText('3 people · downloaded when opened');
        // The header names the research's tree, its Connection in the magnifier's place.
        await expect(page.locator('#current-tree-name')).toHaveText(NAME);
        await expect(page.locator('#phone-conn-btn')).toBeVisible();
        await expect(page.locator('#search-open-btn')).toBeHidden();
        // The bar (variant A): Research marked, Descendants gone, (+) hidden with its place kept.
        await expect(page.locator('#bb-view-research')).toBeVisible();
        await expect(page.locator('#bb-view-research')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#bb-view-descendants')).toBeHidden();
        await expect(page.locator('#bb-view-family')).not.toHaveClass(/\bactive\b/);
        const fab = await page.locator('#bottom-bar-fab').evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { visibility: getComputedStyle(el).visibility, width: r.width };
        });
        expect(fab).toEqual({ visibility: 'hidden', width: 48 });
        // Nothing of the tree came: never asked.
        await page.waitForTimeout(800);
        expect(asked.trees, 'tree.ged asked').toBe(0);
        expect(gw.tunnelled.filter(r => r.p === 'tree.ged')).toEqual([]);
        // Descendants under More.
        await page.locator('#bb-view-more').click();
        await expect(page.locator('#sheet-descendants')).toBeVisible();
        await shot(page, 'vyzkum-390');
    });

    test('Family: the download with its progress over the dock, then the tree; Back returns to the screen, Family again at once', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        let release!: () => void;
        const asked = research(gw, { hold: new Promise<void>(r => { release = r; }) });
        await pairedOnScreen(page, gw);
        await page.locator('#bb-view-family').click();
        await expect(loadToast(page)).toBeVisible({ timeout: 10000 });
        await expect(loadToast(page).locator('.toast-title')).toHaveText('Loading the tree from the research…');
        // Over the dock, the screen alive under it, Research still the one marked.
        const gap = await page.evaluate(() => {
            const t = document.querySelector('.toast[data-kind="tree-load"]')!.getBoundingClientRect();
            const d = document.getElementById('phone-dock')!.getBoundingClientRect();
            return d.top - t.bottom;
        });
        expect(gap).toBeGreaterThanOrEqual(0);
        await expect(screen(page)).toBeVisible();
        await expect(page.locator('#bb-view-research')).toHaveAttribute('aria-current', 'page');
        await shot(page, 'vyzkum-stahovani-390');
        release();
        await expect(josef(page)).toBeVisible({ timeout: 15000 });
        await expect(screen(page)).toBeHidden();
        await expect(page.locator('#bb-view-research')).not.toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#bb-view-family')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#bottom-bar-fab')).toBeVisible();
        expect(asked.trees).toBe(1);
        // System Back: the screen again, the tree kept.
        await page.goBack();
        await expect(screen(page)).toBeVisible();
        await expect(page.locator('#bb-view-research')).toHaveAttribute('aria-current', 'page');
        await expect(screen(page).locator('.phone-dock__note')).toHaveCount(0);
        // Family again: at once, nothing downloaded again.
        await page.locator('#bb-view-family').click();
        await expect(josef(page)).toBeVisible();
        await expect(screen(page)).toBeHidden();
        expect(asked.trees).toBe(1);
        await expect(loadToast(page)).toHaveCount(0);
        // Research in the bar: back to the screen.
        await page.locator('#bb-view-research').click();
        await expect(screen(page)).toBeVisible();
    });

    test('Cancel of the download: the Research screen stays as it was, no tree', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        let release!: () => void;
        const asked = research(gw, { hold: new Promise<void>(r => { release = r; }) });
        await pairedOnScreen(page, gw);
        await page.locator('#bb-view-table').click();
        await expect(loadToast(page)).toBeVisible({ timeout: 10000 });
        await loadToast(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(loadToast(page)).toHaveCount(0);
        release();
        await page.waitForTimeout(500);
        await expect(screen(page)).toBeVisible();
        await expect(page.locator('#bb-view-research')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#tree-container .person-card', { hasText: 'Josef' })).toHaveCount(0);
        expect(asked.trees).toBe(1);
    });

    test('a phone held sideways: two columns, each scrolled on its own', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await seeds(page);
        research(gw);
        await pairedOnScreen(page, gw);
        await expect(screen(page).locator('.phone-sec[data-sec="lines"] .phone-sec__title')).toBeVisible();
        const cols = await page.evaluate(() => {
            const box = (sel: string) => {
                const el = document.querySelector<HTMLElement>(sel)!;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, overflowY: getComputedStyle(el).overflowY };
            };
            return {
                a: box('.phone-research__col--a'),
                b: box('.phone-research__col--b'),
                dock: box('#phone-dock'),
                wide: document.documentElement.scrollWidth <= window.innerWidth,
                aSecs: [...document.querySelectorAll('.phone-research__col--a .phone-sec')].map(s => (s as HTMLElement).dataset.sec),
                bSecs: [...document.querySelectorAll('.phone-research__col--b .phone-sec')].map(s => (s as HTMLElement).dataset.sec),
            };
        });
        expect(cols.a.right).toBeLessThanOrEqual(cols.b.left + 1);
        expect(cols.a.overflowY).toBe('auto');
        expect(cols.b.overflowY).toBe('auto');
        expect(cols.aSecs).toEqual(['now', 'waiting']);
        expect(cols.bSecs).toEqual(['finds', 'lines']);
        // The dock under the right column.
        expect(cols.dock.left).toBeGreaterThanOrEqual(cols.b.left - 1);
        expect(cols.wide, 'no sideways scroll').toBe(true);
        await shot(page, 'vyzkum-844x390');
    });

    test('a tablet is as before: the tree opens at the start, no Research screen, Descendants in the bar', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 1280 });
        await seeds(page);
        const asked = research(gw);
        await page.goto(gw.pairCode().url);
        await expect(josef(page)).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        await expect(screen(page)).toHaveCount(0);
        await expect(page.locator('#bb-view-research')).toBeHidden();
        await expect(page.locator('#bb-view-descendants')).toBeVisible();
        await expect(page.locator('#phone-conn-btn')).toBeHidden();
        expect(asked.trees).toBe(1);
    });
});

/** Two lines at work (each its run), the research's other answers as before; `answer` gives the writes. */
function atWork(gw: FakeGateway, answer: (req: { p: string; m: string; b?: unknown }) => TunnelReply | undefined): void {
    research(gw);
    const at = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
    const lines = [
        { id: 'G0001', n: 1, name: 'Předci Jana Pýchavky', direction: 'ancestors', way: 'up', state: 'active', tasks: 2, waiting: 1, working: true, since: at(2880), focus: 'P0001' },
        { id: 'G0002', n: 2, name: 'Potomci Josefa Pýchavky', direction: 'descendants', way: 'down', state: 'active', tasks: 1, waiting: 0, working: true, since: at(1800), focus: 'P0003' },
        { id: 'G0003', n: 3, name: 'Bedlovi z Mlýnků', direction: 'ancestors', way: 'up', state: 'paused', tasks: 3, waiting: 0, working: false, since: at(900), focus: 'P0002' },
    ];
    // The research as written: its order and its lines' states.
    gw.glance = () => fakeGlance({ id: PYCH, name: NAME }, {
        lastWorked: undefined,
        lines,
        now: [
            { since: at(35), line: 'G0001', way: 'up', task: { id: 'T0003', text: 'Křest Jana Pýchavky 1851' }, person: 'P0001', run: 'run-a1' },
            { since: at(12), line: 'G0002', way: 'down', task: { id: 'T0009', text: 'Sňatek Josefa Pýchavky' }, person: 'P0003', run: 'run-b2' },
        ],
        runs: [
            { id: 'run-a1', line: 'G0001', way: 'up', since: at(35), state: 'working', task: 'T0003' },
            { id: 'run-b2', line: 'G0002', way: 'down', since: at(12), state: 'working', task: 'T0009' },
        ],
    });
    const glanceAndTree = gw.onTunnel;
    gw.onTunnel = async (req, device) => {
        const reply = answer(req);
        if (reply?.s === 200 && req.p === 'directions/order') {
            (bodyOf(req.b) as { order: string[] }).order.forEach((id, i) => { lines.find(l => l.id === id)!.n = i + 1; });
        }
        const state = /^directions\/(G\d+)\/state$/.exec(req.p);
        if (reply?.s === 200 && state) {
            const d = (bodyOf(req.b) as { do: string }).do;
            lines.find(l => l.id === state[1])!.state = d === 'pause' ? 'paused' : d === 'done' ? 'done' : 'active';
        }
        return reply ?? glanceAndTree(req, device);
    };
}

const nowRows = (page: Page) => screen(page).locator('.phone-sec[data-sec="now"] .phone-line');
const lineRows = (page: Page) => screen(page).locator('.phone-sec[data-sec="lines"] .phone-line');
const sheet = (page: Page) => page.locator('.bottom-sheet-overlay');
/** A tunnelled request's JSON body (sent as its text). */
const bodyOf = (b: unknown): unknown => (typeof b === 'string' ? JSON.parse(b) : b);
const writes = (p: string) => gw.tunnelled.filter(r => r.p === p && r.m === 'POST').map(r => ({ ...r, b: bodyOf(r.b) }));
/** No mark of a research action on the screen nor in a sheet (an action through the bridge has none). */
async function noMarks(page: Page): Promise<void> {
    await expect(page.locator('#phone-research .research-open-mark, #phone-research .research-ai-badge, .bottom-sheet-overlay .research-open-mark, .bottom-sheet-overlay .research-ai-badge')).toHaveCount(0);
    for (const t of await page.locator('#phone-research, .bottom-sheet-overlay').allInnerTexts()) expect(t).not.toMatch(/[◆↗]/);
}

test.describe('Now and Lines (en)', () => {
    test.use({ locale: 'en-US' });

    test('Now with two lines: glyph, line, task, since when, the day; Lines in the order of work', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        atWork(gw, () => undefined);
        await pairedOnScreen(page, gw);
        await expect(screen(page).locator('.phone-sec[data-sec="now"] .phone-sec__title')).toHaveText('Now · 2 lines');
        await expect(nowRows(page)).toHaveCount(2);
        await expect(nowRows(page).nth(0).locator('.phone-line__glyph')).toHaveText('↑');
        await expect(nowRows(page).nth(0).locator('.phone-line__name')).toHaveText('Předci Jana Pýchavky');
        await expect(nowRows(page).nth(0).locator('.phone-line__task')).toHaveText('Křest Jana Pýchavky 1851');
        await expect(nowRows(page).nth(0).locator('.phone-line__meta')).toHaveText(/^working since \d/);
        await expect(nowRows(page).nth(1).locator('.phone-line__glyph')).toHaveText('↓');
        await expect(screen(page).locator('.phone-sec__day')).toHaveText('Last 24 h: 1 person · 1 source · 4 saves');
        await expect(lineRows(page).locator('.phone-line__n')).toHaveText(['1', '2', '3']);
        await expect(lineRows(page).nth(2).locator('.phone-line__chip')).toHaveText('paused');
        await expect(lineRows(page).nth(0).locator('.phone-line__meta')).toHaveText('2 tasks');
        // The ⋯ is a 44 px target.
        const more = await nowRows(page).nth(0).locator('.phone-line__more').boundingBox();
        expect(more?.width).toBeGreaterThanOrEqual(44);
        expect(more?.height).toBeGreaterThanOrEqual(44);
        await nowRows(page).nth(0).locator('.phone-line__more').click();
        await expect(sheet(page).locator('.bottom-sheet-menu-title')).toHaveText('Předci Jana Pýchavky');
        await expect(sheet(page).locator('.bottom-sheet-label')).toHaveText([/^Show in tree/, /^Line actions…/, /^Stop run/]);
        await expect(sheet(page).locator('.bottom-sheet-sub')).toHaveText('the agent on Pracovna stops after the step in progress');
        await noMarks(page);
        await shot(page, 'vyzkum-ted-390');
    });

    test('Stop run: asked first, then runs/stop with the run, the row "stopping…"', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        atWork(gw, req => (req.p === 'runs/stop' ? { s: 200, body: { head: '4d8b0f2a16c3', run: null } } : undefined));
        await pairedOnScreen(page, gw);
        await nowRows(page).nth(1).locator('.phone-line__more').click();
        await sheet(page).locator('#phone-now-stop').click();
        const ask = page.locator('.dialog-confirm.active');
        await expect(ask).toContainText('Stop the run of the line Potomci Josefa Pýchavky?');
        await ask.locator('#confirm-cancel-btn').click();
        expect(writes('runs/stop')).toEqual([]);
        await nowRows(page).nth(1).locator('.phone-line__more').click();
        await sheet(page).locator('#phone-now-stop').click();
        await page.locator('.dialog-confirm.active #confirm-ok-btn').click();
        await expect.poll(() => writes('runs/stop').map(r => r.b)).toEqual([{ run: 'run-b2' }]);
        await expect(nowRows(page).nth(1).locator('.phone-line__meta')).toHaveText('stopping…');
        await expect(nowRows(page).nth(0).locator('.phone-line__meta')).toHaveText(/^working since/);
    });

    test('Move up: the order sent, the lines numbered again; a 409 puts the row back and says the research is being written', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        let refuse = false;
        atWork(gw, req => {
            if (req.p !== 'directions/order') return undefined;
            if (refuse) return { s: 409, body: { error: 'research.write', code: 'research.write', text: 'Writing in progress' } };
            return { s: 200, body: { head: '4d8b0f2a16c3', order: (bodyOf(req.b) as { order: string[] }).order, ignored: [] } };
        });
        await pairedOnScreen(page, gw);
        await lineRows(page).nth(1).click();
        await expect(sheet(page).locator('.bottom-sheet-menu-title')).toHaveText('Potomci Josefa Pýchavky');
        await expect(sheet(page).locator('.bottom-sheet-menu-sub')).toHaveText('No. 2 in the order of work · 1 task');
        await expect(sheet(page).locator('.bottom-sheet-quiet')).toHaveText('“Work on this line” (agent) is on Pracovna.');
        await noMarks(page);
        await sheet(page).locator('#phone-line-up').click();
        await expect.poll(() => writes('directions/order').map(r => r.b)).toEqual([{ order: ['G0002', 'G0001', 'G0003'] }]);
        await expect(lineRows(page).locator('.phone-line__name')).toHaveText(['Potomci Josefa Pýchavky', 'Předci Jana Pýchavky', 'Bedlovi z Mlýnků']);
        await expect(lineRows(page).locator('.phone-line__n')).toHaveText(['1', '2', '3']);
        // Refused: the row back where it was, the sentence under the list.
        refuse = true;
        await lineRows(page).nth(2).locator('.phone-line__more').click();
        await sheet(page).locator('#phone-line-first').click();
        await expect.poll(() => writes('directions/order').length).toBe(2);
        await expect(lineRows(page).locator('.phone-line__name')).toHaveText(['Potomci Josefa Pýchavky', 'Předci Jana Pýchavky', 'Bedlovi z Mlýnků']);
        await expect(screen(page).locator('.phone-sec__warn')).toHaveText('The research is being written just now — again in a moment.');
        await expect(page.locator('.toast')).toHaveCount(0);
        await shot(page, 'vyzkum-linie-zapis-390');
        // A write that goes: the sentence gone.
        refuse = false;
        await lineRows(page).nth(1).locator('.phone-line__more').click();
        await sheet(page).locator('#phone-line-down').click();
        await expect.poll(() => writes('directions/order').length).toBe(3);
        await expect(screen(page).locator('.phone-sec__warn')).toHaveCount(0);
    });

    test('End…: asked first, then the line ended through the bridge', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        atWork(gw, req => (/^directions\/G\d+\/state$/.test(req.p) ? { s: 200, body: { head: '4d8b0f2a16c3' } } : undefined));
        await pairedOnScreen(page, gw);
        await lineRows(page).nth(0).locator('.phone-line__more').click();
        await expect(sheet(page).locator('.bottom-sheet-label')).toHaveText(['Move down', 'Pause', 'Show in tree', 'End…']);
        await sheet(page).locator('#phone-line-end').click();
        const ask = page.locator('.dialog-confirm.active');
        await expect(ask).toContainText('End the line Předci Jana Pýchavky?');
        await expect(ask.locator('#confirm-cancel-btn')).toHaveText('Back');
        await ask.locator('#confirm-ok-btn').click();
        await expect.poll(() => writes('directions/G0001/state').map(r => r.b)).toEqual([{ do: 'done' }]);
        await expect(lineRows(page).nth(0).locator('.phone-line__chip')).toHaveText('ended');
        // A paused line: Resume.
        await lineRows(page).nth(2).locator('.phone-line__more').click();
        await sheet(page).locator('#phone-line-resume').click();
        await expect.poll(() => writes('directions/G0003/state').map(r => r.b)).toEqual([{ do: 'resume' }]);
    });
});
