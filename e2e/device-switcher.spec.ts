import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway } from './device-gateway.js';

/**
 * The device mode (spec 094 §3) through the fake gateway: the tree switcher's
 * second line with the connection (on the computer / connecting / not
 * reachable), and what belongs to the computer not offered on the device.
 * Outside the device mode the switcher is as before. Invented data only (the
 * Pýchavkovi of Mlýnky, the computer Pracovna). `STROM_SHOTS_DIR` set:
 * screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const TREE_DE = 'Die Pýchavkas aus Mlýnky in Mähren';
const PC_DE = 'Arbeitszimmer-Rechner im Dachgeschoss';

function ged(id: string): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 24 NOV 2026', `1 _STROM_TREE ${id}`, '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Jan /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Josef /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

/** The research behind the gateway: one tree, its status and file. */
function research(gw: FakeGateway, name: string, computer: string): void {
    gw.trees = [{ id: PYCH, name, archive: false }];
    // the computer's name is the page's own host: no other address looked for
    gw.computer = { name: '127.0.0.1', label: computer };
    gw.onTunnel = (req, device) => {
        if (req.p === 'status') {
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway'], tree: { id: PYCH, name }, head: 'h1',
                    persons: 3, working: [], waiting: [], queue: [], links: [],
                    device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] },
                },
            };
        }
        if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged(PYCH) };
        return undefined;
    };
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            // the icon's quiet line is §2's: not over the toolbar here
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

/** Paired through the QR code's address, the tree open. */
async function openPaired(page: Page, gw: FakeGateway): Promise<void> {
    await page.goto(gw.pairCode().url);
    await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#device-boot')).toHaveCount(0);
}

const state = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => (globalThis as unknown as { __stromDevice: { connection: () => { state: string } | null } }).__stromDevice?.connection()?.state);

/** Nothing wider than the window; the toolbar's controls side by side, never over each other. */
async function expectToolbarFits(page: Page): Promise<void> {
    const m = await page.evaluate(() => {
        const box = (el: Element | null) => el ? el.getBoundingClientRect() : null;
        const btn = box(document.querySelector('.tree-switcher-btn'));
        const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const others = [...document.querySelectorAll('.toolbar > *')]
            .filter(el => !el.classList.contains('tree-switcher') && visible(el))
            .map(el => ({ name: el.className || el.tagName, r: el.getBoundingClientRect() }));
        const hit = btn ? others.filter(o => o.r.left < btn.right - 0.5 && btn.left < o.r.right - 0.5 && o.r.top < btn.bottom - 0.5 && btn.top < o.r.bottom - 0.5).map(o => o.name) : ['no switcher'];
        return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            right: btn ? btn.right - window.innerWidth : 0,
            hit,
        };
    });
    expect(m.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.right, 'switcher past the window').toBeLessThanOrEqual(0);
    expect(m.hit, 'toolbar controls over the switcher').toEqual([]);
}

/** Both lines inside the button: cut with an ellipsis, never spilling out of it. */
async function expectLinesInside(page: Page): Promise<{ nameCut: boolean; lineCut: boolean }> {
    return page.evaluate(() => {
        const btn = document.querySelector('.tree-switcher-btn')!.getBoundingClientRect();
        const name = document.getElementById('current-tree-name')!;
        const text = document.querySelector<HTMLElement>('#current-tree-conn .tree-switcher-conn-text')!;
        for (const el of [name, text]) {
            const r = el.getBoundingClientRect();
            if (r.right > btn.right + 0.5 || r.left < btn.left - 0.5 || r.bottom > btn.bottom + 0.5 || r.top < btn.top - 0.5) throw new Error(`${el.id || el.className} outside the switcher`);
            if (getComputedStyle(el).textOverflow !== 'ellipsis') throw new Error(`${el.id || el.className} without an ellipsis`);
        }
        return { nameCut: name.scrollWidth > name.clientWidth, lineCut: text.scrollWidth > text.clientWidth };
    });
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

    test('the switcher\'s second line follows the connection: on the computer, not reachable, connecting, back', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, 'Pýchavkovi z Mlýnků', 'Pracovna');
        await openPaired(page, gw);
        await expect.poll(() => state(page)).toBe('connected');
        const conn = page.locator('#current-tree-conn');
        await expect(page.locator('#current-tree-name')).toHaveText('Pýchavkovi z Mlýnků');
        await expect(conn).toBeVisible();
        await expect(conn).toHaveText('on computer Pracovna');
        await expect(conn.locator('.phone-dot')).toHaveClass(/is-on/);
        // the name in the serif at 16 px, the line at 12 px; the button stays 44 px high
        const look = await page.evaluate(() => {
            const n = getComputedStyle(document.getElementById('current-tree-name')!);
            const l = getComputedStyle(document.getElementById('current-tree-conn')!);
            return { nameSize: n.fontSize, nameFont: n.fontFamily, lineSize: l.fontSize, btn: document.querySelector('.tree-switcher-btn')!.getBoundingClientRect().height };
        });
        expect(look.nameSize).toBe('16px');
        expect(look.nameFont.toLowerCase()).toMatch(/serif|georgia|fraunces|source serif/);
        expect(look.lineSize).toBe('12px');
        expect(look.btn).toBe(44);
        await expectToolbarFits(page);

        // the computer away
        gw.unreachable = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unreachable');
        await expect(conn).toHaveText('Pracovna not reachable');
        await expect(conn.locator('.phone-dot')).toHaveClass(/is-error/);

        // it answers again, slowly: connecting meanwhile
        gw.unreachable = false;
        gw.stall = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('connecting');
        await expect(conn).toHaveText('connecting to Pracovna…');
        await expect(conn.locator('.phone-dot')).toHaveClass(/is-wait/);
        await expectToolbarFits(page);

        // and back
        gw.stall = false;
        await expect.poll(() => state(page), { timeout: 30000 }).not.toBe('connecting');
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page), { timeout: 30000 }).toBe('connected');
        await expect(conn).toHaveText('on computer Pracovna');
    });

    test('outside the device mode the switcher has one line, as before', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        await page.goto('/strom.html');
        await expect(page.locator('#current-tree-name')).not.toHaveText('…', { timeout: 10000 });
        await expect(page.locator('#current-tree-conn')).toBeHidden();
        const m = await page.evaluate(() => ({
            device: document.body.classList.contains('device-mode'),
            lines: getComputedStyle(document.querySelector('.tree-switcher-lines')!).display,
            btn: document.querySelector('.tree-switcher-btn')!.getBoundingClientRect().height,
        }));
        expect(m).toEqual({ device: false, lines: 'contents', btn: 38 });
    });
});

test.describe('de', () => {
    test.use({ locale: 'de-DE' });

    test('a long tree name and a long computer name: both lines cut with an ellipsis at every width, light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, TREE_DE, PC_DE);
        await openPaired(page, gw);
        await expect.poll(() => state(page)).toBe('connected');
        const conn = page.locator('#current-tree-conn');
        await expect(page.locator('#current-tree-name')).toHaveText(TREE_DE);
        await expect(conn).toHaveText(`auf dem Computer ${PC_DE}`);
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [360, 390, 1024, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : width === 1024 ? 768 : 844 });
                await expect(conn).toBeVisible();
                await expectToolbarFits(page);
                const cut = await expectLinesInside(page);
                // a phone has no room for either whole: both cut, never wrapped
                if (width <= 390) expect(cut, `${width}`).toEqual({ nameCut: true, lineCut: true });
                if (width === 390 || width === 1440) await shot(page, `d4-prepinac-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
            }
        }
        // not reachable, in German at a phone's width
        await page.emulateMedia({ colorScheme: 'light' });
        await page.setViewportSize({ width: 360, height: 800 });
        gw.unreachable = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unreachable');
        await expect(conn).toHaveText(`${PC_DE} nicht erreichbar`);
        await expectToolbarFits(page);
        await expectLinesInside(page);
    });
});

/** The tree's action rows offered here (the one list behind Actions › Tree, More and the tree manager). */
const treeActionKeys = (page: Page, source: 'actions' | 'manager'): Promise<string[]> => page.evaluate(async (src) => {
    const ui = (window as unknown as { Strom: { UI: { treeActionGroups: (id: string, s: string) => Promise<{ rows: { key: string }[] }[]> } } }).Strom.UI;
    const id = (window as unknown as { Strom: { TreeManager?: { getActiveTreeId: () => string } } }).Strom.TreeManager?.getActiveTreeId()
        ?? document.querySelector<HTMLElement>('#tree-switcher-dropdown [data-tree-id].active')?.dataset.treeId ?? '';
    return (await ui.treeActionGroups(id, src)).flatMap(g => g.rows.map(r => r.key));
}, source);

/** ⌘S / Ctrl+S taken by the app (the browser's own default otherwise). */
const saveKeyTaken = (page: Page): Promise<boolean> => page.evaluate(() => [{ ctrlKey: true }, { metaKey: true }].some(mod => {
    const ev = new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true, ...mod });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
}));

test.describe('what belongs to the computer (3.7)', () => {
    test.use({ locale: 'en-US' });

    test('not offered on a device: import and managing trees, deleting, backups, a linked file, ⌘S; one quiet line instead; Export stays', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw, 'Pýchavkovi z Mlýnků', 'Pracovna');
        await openPaired(page, gw);
        await expect.poll(() => state(page)).toBe('connected');
        await expect(page.locator('body')).toHaveClass(/device-mode/);

        // the switcher's list: the trees, then one quiet line
        await page.locator('.tree-switcher-btn').click();
        const dropdown = page.locator('#tree-switcher-dropdown');
        await expect(dropdown).toHaveClass(/active/);
        await expect(dropdown.locator('#tree-switcher-not-here')).toHaveText('On computer Pracovna. New tree, import and managing trees are on the computer with the research.');
        await expect(dropdown.locator('#tree-switcher-import')).toHaveCount(0);
        await expect(dropdown.getByText('Manage trees')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // the tree's actions: no deleting, no backups, no managing trees
        const keys = await treeActionKeys(page, 'actions');
        for (const gone of ['delete', 'snapshots', 'manageTrees']) expect(keys, gone).not.toContain(gone);
        // the file's own state, the export reminder and a linked file: nowhere
        for (const id of ['#file-link-indicator', '#unsaved-copy-indicator', '#actions-storage-row', '#actions-export-reminder']) {
            await expect(page.locator(id), id).toBeHidden();
        }
        expect(await saveKeyTaken(page)).toBe(false);

        // Export… stays, without linking a file
        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#actions-export-row')).toBeVisible();
        await page.locator('#actions-export-row').click();
        await expect(page.locator('#export-modal')).toHaveClass(/active/);
        for (const el of await page.locator('#export-modal .fsa-only, #export-modal .fsa-linked-only').all()) await expect(el).toBeHidden();
        await page.keyboard.press('Escape');

        // the phone's Trees sheet: the tree, then the quiet line
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.tree-switcher-btn').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toContainText('Pýchavkovi z Mlýnků');
        await expect(sheet.locator('.bottom-sheet-quiet')).toHaveText('On computer Pracovna. New tree, import and managing trees are on the computer with the research.');
        await expect(sheet.getByText('Import…')).toHaveCount(0);
        await expect(sheet.getByText('Manage trees')).toHaveCount(0);
    });

    test('outside the device mode all of it is there as before', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        await page.goto('/strom.html');
        await expect(page.locator('#current-tree-name')).not.toHaveText('…', { timeout: 10000 });
        await page.locator('.tree-switcher-btn').click();
        await expect(page.locator('#tree-switcher-import')).toBeVisible();
        await expect(page.locator('#tree-switcher-not-here')).toHaveCount(0);
        await page.keyboard.press('Escape');
        const keys = await treeActionKeys(page, 'actions');
        expect(keys).toEqual(expect.arrayContaining(['delete', 'snapshots', 'manageTrees']));
        expect(await saveKeyTaken(page)).toBe(true);
    });
});

test.describe('de, what belongs to the computer', () => {
    test.use({ locale: 'de-DE' });

    test('the quiet line in the switcher\'s list and the Trees sheet at every width, light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw, TREE_DE, PC_DE);
        await openPaired(page, gw);
        await expect.poll(() => state(page)).toBe('connected');
        const text = `Auf dem Computer ${PC_DE}. Neuer Stammbaum, Import und Verwaltung der Stammbäume gibt es am Computer mit der Forschung.`;
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [360, 390, 1024, 1440]) {
                await page.setViewportSize({ width, height: width > 1024 ? 900 : width === 1024 ? 768 : 844 });
                await page.locator('.tree-switcher-btn').click();
                const quiet = width <= 640 ? page.locator('.bottom-sheet-quiet', { hasText: 'Neuer Stammbaum' }) : page.locator('#tree-switcher-not-here');
                await expect(quiet).toHaveText(text);
                const m = await quiet.evaluate(el => {
                    const r = el.getBoundingClientRect();
                    return { page: document.documentElement.scrollWidth - window.innerWidth, left: r.left, right: r.right - window.innerWidth, own: el.scrollWidth - el.clientWidth };
                });
                expect(m.page, `${width}: page scrolls sideways`).toBeLessThanOrEqual(0);
                expect(m.left, `${width}: the line starts off the window`).toBeGreaterThanOrEqual(0);
                expect(m.right, `${width}: the line runs past the window`).toBeLessThanOrEqual(0);
                expect(m.own, `${width}: the line scrolls`).toBeLessThanOrEqual(0);
                if (width === 390 || width === 1440) await shot(page, `d4-stromy-jen-pocitac-de-${width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
                await page.keyboard.press('Escape');
                await expect(quiet).toBeHidden();
            }
        }
    });
});
