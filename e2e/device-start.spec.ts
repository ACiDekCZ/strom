import { test, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway } from './device-gateway.js';

/**
 * The first start on a device of the home network (spec 094 §2), through the
 * fake gateway: the QR code's address → paired → the tree chooser → the tree;
 * a code that paired nothing; the home-screen icon's code and its quiet line
 * with "How". Invented data only (the Pýchavkovi of Mlýnky, the computer
 * Pracovna). `STROM_SHOTS_DIR` set: screenshots of the screens go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const HROT = '7b2e3d4f-5c6a-4b7c-9d8e-0f1a2b3c4d5e';
const MATR = '8c3f4e5a-6d7b-4c8d-8e9f-1a2b3c4d5e6f';

/** The research's versions (its commits). */
const H1 = '3c7a9e1f05b2';
const H2 = '8d4b6f2a91c0';

/** The research's tree as its export gives it (its head and the links it takes: sends, so the tree is editable). */
function ged(id: string, surname: string, more: string[] = [], head = H1): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 24 NOV 2026', `1 _STROM_TREE ${id}`, `1 _STROM_HEAD ${head}`,
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', `1 NAME Jan /${surname}/`, '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', `1 NAME Josef /${surname}/`, '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        ...more,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

interface Research {
    heads: Record<string, string>;
    geds: Record<string, string>;
    rows: Record<string, { persons: number; working: unknown[]; waiting: unknown[] }>;
    actions: string[];
}

/** The research behind the gateway: its trees' statuses and files, `device/home` when announced. */
function research(gw: FakeGateway, trees: { id: string; name: string; archive: boolean }[], o: { actions?: string[] } = {}): Research {
    gw.trees = trees;
    const r: Research = {
        heads: Object.fromEntries(trees.map(t => [t.id, H1])),
        geds: Object.fromEntries(trees.map(t => [t.id, ged(t.id, t.id === HROT ? 'Hrotek' : 'Pýchavka')])),
        rows: {
            [PYCH]: { persons: 412, working: [{ person: 'P0001', task: 'T0001' }], waiting: [] },
            [HROT]: { persons: 186, working: [], waiting: [{ id: 'W1' }, { id: 'W2' }, { id: 'W3' }] },
            [MATR]: { persons: 1204, working: [], waiting: [] },
        },
        actions: o.actions ?? ['device.rename', 'device.unpair'],
    };
    gw.onTunnel = (req, device) => {
        const tree = gw.trees.find(t => t.id === req.tree) ?? gw.trees[0];
        if (req.p === 'status') {
            const row = r.rows[tree.id] ?? { persons: 3, working: [], waiting: [] };
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway'], tree: { id: tree.id, name: tree.name }, head: r.heads[tree.id],
                    persons: row.persons, working: [], waiting: [], queue: [], links: [],
                    // what it takes (sends by hand): the tree is the research's, editable, its newer version loaded when asked
                    accepts: { mode: 'research', sync: { auto: 'off' } },
                    device: { id: device.id, name: device.name, kind: device.kind, actions: r.actions },
                    // what works and waits there now (a test puts them into the lists)
                    rows: row,
                },
            };
        }
        if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: r.geds[tree.id] };
        if (req.p === 'device/home' && req.m === 'POST' && r.actions.includes('device.home')) {
            return { s: 200, body: { url: `${gw.origin}/#home.${b64(16)}.${b64(32)}`, expiresAt: Date.now() + 86_400_000 } };
        }
        return undefined;
    };
    return r;
}

function b64(n: number): string {
    return randomBytes(n).toString('base64url');
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try { localStorage.setItem('strom-tour-offered', '1'); } catch { /* none */ }
    });
}

/** Nothing wider than the window (the page, and the given element inside itself). */
async function expectNoOverflow(page: Page, selector: string): Promise<void> {
    const m = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            el: el ? el.scrollWidth - el.clientWidth : 0,
            texts: el ? [...el.querySelectorAll<HTMLElement>('*')].filter(c => c.getBoundingClientRect().right > window.innerWidth + 0.5 || c.getBoundingClientRect().left < -0.5).map(c => c.className || c.tagName) : [],
        };
    }, selector);
    expect(m.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.el, `${selector} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.texts, `${selector}: elements outside the window`).toEqual([]);
}

function overlaps(a: { x: number; y: number; width: number; height: number } | null, b: { x: number; y: number; width: number; height: number } | null): boolean {
    if (!a || !b) return false;
    return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
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

    test('the QR code\'s address: connecting, paired, the one tree in Family, then a change from elsewhere', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const r = research(gw, [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }]);
        const code = gw.pairCode();
        await page.goto(code.url);
        const boot = page.locator('#device-boot');
        await expect(boot).toContainText('Paired with Pracovna');
        await expect(boot.locator('.device-boot-logo')).toHaveText('Strom');
        // the code out of the address at once
        expect(new URL(page.url()).hash).toBe('');
        // the tree, never a chooser (one tree)
        await expect(boot).toHaveCount(0, { timeout: 15000 });
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible();
        expect(await page.evaluate(() => document.body.dataset.viewMode ?? 'family')).toBe('family');
        expect(gw.tunnelled.some(t => t.p === 'tree.ged' && t.tree === PYCH)).toBe(true);
        // the quiet line of the icon, under the toolbar and the person panel, overlapping nothing
        const line = page.locator('#device-home-line');
        await expect(line).toContainText('A home-screen icon opens the research with one tap.');
        await expect(line.locator('button')).toHaveText(['How', '×']);
        for (const other of ['.toolbar', '#focus-controls']) {
            expect(overlaps(await line.boundingBox(), await page.locator(other).boundingBox()), other).toBe(false);
        }
        await expectNoOverflow(page, '#device-home-line');

        // another device (or the agent) changed the tree: the research's newer version, loaded when asked, as the
        // research's tree on the computer (the tree here is editable, not followed live)
        r.heads[PYCH] = H2;
        r.geds[PYCH] = ged(PYCH, 'Pýchavka', ['0 @P0004@ INDI', '1 NAME Ludmila /Pýchavková/', '1 SEX F', '1 BIRT', '2 DATE 1883', '1 REFN P0004', '1 FAMC @F0001@'], H2)
            .replace('1 CHIL @P0003@', '1 CHIL @P0003@\n1 CHIL @P0004@');
        // the research's word reaches the device at its next question (the poll, asked now rather than waited for)
        type Sync = { pollResearchBridge(): Promise<boolean>; currentResearchSyncState(): { core: string } };
        await expect.poll(() => page.evaluate(async () => {
            const ui = window.Strom.UI as unknown as Sync;
            await ui.pollResearchBridge();
            return ui.currentResearchSyncState().core;
        }), { timeout: 15000 }).toBe('newer');
        await page.locator('#bb-view-more').click();
        const state = page.locator('#research-sheet-state');
        await expect(state).toBeVisible();
        await state.locator('button').click();
        // what loading changes, asked first (unless it was said not to ask)
        const ask = page.locator('#research-load-modal');
        const ludmila = page.locator('.person-card', { hasText: 'Ludmila' }).first();
        await expect(ask.or(ludmila).first()).toBeVisible({ timeout: 15000 });
        if (await ask.isVisible()) await ask.locator('button.primary').last().click();
        await expect(ludmila).toBeVisible({ timeout: 15000 });
    });

    test('a code that paired nothing: one screen with one "Try again"', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }]);
        await page.goto(`${gw.origin}/pair?m=app#${b64(16)}.${b64(32)}`);
        const boot = page.locator('#device-boot');
        await expect(boot).toContainText('This code is no longer valid.');
        await expect(boot).toContainText('Research → Devices → New code');
        await expect(boot.locator('button')).toHaveCount(1);
        await expect(boot.getByRole('button', { name: 'Try again' })).toBeVisible();
        expect(new URL(page.url()).hash).toBe('');
        const pairs = (): number => gw.requests.filter(q => q === 'POST /device/pair').length;
        const before = pairs();
        await boot.getByRole('button', { name: 'Try again' }).click();
        await expect.poll(pairs).toBe(before + 1);
        await expect(boot).toContainText('This code is no longer valid.');
        await expect(boot.locator('button')).toHaveCount(1);
        expect(await page.evaluate(() => 'strom-device-paired' in localStorage)).toBe(false);
    });

    test('the icon\'s code pairs the icon (no quiet line there); an expired one says the icon is not paired', async ({ page }) => {
        await seeds(page);
        research(gw, [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }]);
        const home = gw.homeCode();
        await page.goto(home.url);
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        expect(gw.devices).toHaveLength(1);
        await expect(page.locator('#device-home-line')).toHaveCount(0);

        // another browser with the icon's code gone stale (2.8b)
        const other = await page.context().browser()!.newContext({ locale: 'en-US' });
        const p2 = await other.newPage();
        await seeds(p2);
        await p2.goto(`${gw.origin}/#home.${b64(16)}.${b64(32)}`);
        const boot = p2.locator('#device-boot');
        await expect(boot).toContainText('The home-screen icon is not paired yet.');
        await expect(boot).toContainText('Research → Devices → Connect a device');
        await expect(boot.getByRole('button', { name: 'Try again' })).toBeVisible();
        await other.close();
    });

    test('the quiet line: "How" by system, the icon\'s own code in the address, × hides it for good', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw, [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }], { actions: ['device.rename', 'device.unpair', 'device.home'] });
        await page.goto(gw.pairCode().url);
        const line = page.locator('#device-home-line');
        await expect(line).toBeVisible({ timeout: 15000 });
        // the person chip under the line, not under it
        expect(overlaps(await line.boundingBox(), await page.locator('#focus-controls').boundingBox())).toBe(false);
        await line.getByRole('button', { name: 'How' }).click();
        const dlg = page.locator('#device-home-modal');
        await expect(dlg.getByRole('heading', { name: 'Home-screen icon' })).toBeVisible();
        // a computer here: its bookmark first, then the phones
        await expect(dlg.locator('.device-home-sys h3')).toHaveText(['Computer', 'iPhone and iPad (Safari)', 'Android (Chrome)']);
        await expect(dlg).toContainText('The icon opens the Strom app from Pracovna');
        await expect.poll(() => new URL(page.url()).hash).toMatch(/^#home\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
        expect(gw.tunnelled.find(t => t.p === 'device/home')).toMatchObject({ m: 'POST' });
        await dlg.getByRole('button', { name: 'Done' }).click();
        await expect(dlg).toHaveCount(0);
        await line.getByRole('button', { name: 'Hide' }).click();
        await expect(line).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(300);
        await expect(line).toHaveCount(0);
    });

    test('without device/home announced, "How" asks nothing of the gateway', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }]);
        await page.goto(gw.pairCode().url);
        await page.locator('#device-home-line').getByRole('button', { name: 'How' }).click({ timeout: 15000 });
        await expect(page.locator('#device-home-modal .device-home-sys')).toHaveCount(3);
        await page.waitForTimeout(300);
        expect(gw.tunnelled.some(t => t.p === 'device/home')).toBe(false);
        expect(new URL(page.url()).hash).toBe('');
        await page.keyboard.press('Escape');
        await expect(page.locator('#device-home-modal')).toHaveCount(0);
    });
});

test.describe('de, the browser\'s language at the first start', () => {
    test.use({ locale: 'de-DE' });
    const LONG_TREE = 'Pýchavkovi z Mlýnků a Dolních Lhot';
    const LONG_PC = 'Pracovna v podkroví u Pýchavků';

    test('several trees: the chooser, remembered; long names at every width, light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        gw.computer = { name: 'Pracovna', label: LONG_PC };
        research(gw, [
            { id: PYCH, name: LONG_TREE, archive: false },
            { id: HROT, name: 'Hrotkovi z Hrotova', archive: false },
            { id: MATR, name: 'Mlýnky – farní matrika', archive: true },
        ]);
        // the chooser's rows read the raw lists of what works and waits
        const onTunnel = gw.onTunnel;
        gw.onTunnel = (req, device) => {
            const reply = onTunnel(req, device);
            if (req.p === 'status' && reply && typeof reply.body === 'object' && reply.body) {
                const body = reply.body as Record<string, unknown> & { rows: { working: unknown[]; waiting: unknown[] } };
                return { ...reply, body: { ...body, working: body.rows.working, waiting: body.rows.waiting } };
            }
            return reply;
        };
        await page.goto(gw.pairCode().url);
        const boot = page.locator('#device-boot');
        await expect(boot).toContainText(`Gekoppelt mit ${LONG_PC}`);
        const list = boot.locator('.device-trees');
        await expect(list.getByRole('heading', { name: 'Stammbäume der Forschung' })).toBeVisible();
        await expect(list).toContainText(`auf dem Computer ${LONG_PC}`);
        const rows = list.locator('.device-tree-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('412 Personen');
        await expect(rows.nth(0)).toContainText('arbeitet');
        await expect(rows.nth(0).locator('.phone-dot.is-on')).toHaveCount(1);
        await expect(rows.nth(1)).toContainText('186 Personen');
        await expect(rows.nth(1).locator('.research-count-badge')).toHaveText('3');
        await expect(rows.nth(1)).toContainText('wartet');
        await expect(rows.nth(2).locator('.research-sync-tag')).toHaveText('Strom-Archiv');
        await expect(list).toContainText('Das Gerät merkt sich den Stammbaum');
        // no mark of the terminal or the agent on a device
        await expect(boot.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);

        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [360, 390, 1024, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : width === 1024 ? 768 : 844 });
                await expectNoOverflow(page, '#device-boot');
                // the long name ends in an ellipsis inside its row, never under the chevron
                const name = rows.nth(0).locator('.device-tree-name');
                const chev = rows.nth(0).locator('.device-tree-chev');
                expect(overlaps(await name.boundingBox(), await chev.boundingBox())).toBe(false);
                if (width === 390 || width === 1440) await shot(page, `d4-strom-vyber-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
            }
        }
        await page.emulateMedia({ colorScheme: 'light' });
        await page.setViewportSize({ width: 390, height: 844 });

        await rows.nth(1).click();
        await expect(boot).toHaveCount(0, { timeout: 15000 });
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('strom-device-tree'))).toBe(HROT);
        expect(gw.tunnelled.some(t => t.p === 'tree.ged' && t.tree === HROT)).toBe(true);
        // the stream of the chosen tree
        await expect.poll(() => gw.streamQueries.at(-1)?.get('tree'), { timeout: 15000 }).toBe(HROT);
        // German at the first start: nobody chose a language
        await expect(page.locator('#device-home-line')).toContainText('Ein Symbol auf dem Startbildschirm');

        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [360, 390, 1024, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : width === 1024 ? 768 : 844 });
                await expectNoOverflow(page, '#device-home-line');
                const line = await page.locator('#device-home-line').boundingBox();
                for (const other of ['.toolbar', '#focus-controls']) {
                    const box = await page.locator(other).first().isVisible() ? await page.locator(other).first().boundingBox() : null;
                    expect(overlaps(line, box), `${other} at ${width}`).toBe(false);
                }
                if (width === 390 || width === 1440) await shot(page, `d4-strom-radek-ikony-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#device-home-line').getByRole('button', { name: 'Wie' }).click();
        await expect(page.locator('#device-home-modal')).toContainText(`Das Symbol öffnet die Strom-App von ${LONG_PC}`);
        await expectNoOverflow(page, '#device-home-modal .modal');
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [390, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : 844 });
                await expectNoOverflow(page, '#device-home-modal .modal');
                await shot(page, `d4-jak-ikona-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
            }
        }
        await page.emulateMedia({ colorScheme: 'light' });
        await page.keyboard.press('Escape');

        // remembered: the next start opens that tree without asking
        await page.reload();
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
    });

    test('a code that paired nothing, in German at every width, light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, [{ id: PYCH, name: LONG_TREE, archive: false }]);
        gw.computer = { name: 'Pracovna', label: LONG_PC };
        await page.goto(`${gw.origin}/pair?m=app#${b64(16)}.${b64(32)}`);
        const boot = page.locator('#device-boot');
        await expect(boot).toContainText('Dieser Code gilt nicht mehr.');
        await expect(boot.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [360, 390, 1024, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : width === 1024 ? 768 : 844 });
                await expectNoOverflow(page, '#device-boot');
                if (width === 390 || width === 1440) await shot(page, `d4-kod-neplati-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
            }
        }
    });
});
