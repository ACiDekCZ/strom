import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway } from './device-gateway.js';

/**
 * A device's "Research trees" (spec 094 3.7) through the fake gateway: the
 * tree switcher (a list on a tablet and a computer, a sheet from below on a
 * phone) offers every tree of the research's pairing, each as in the chooser
 * (its name in the serif, its persons, what its research does, the archive's
 * label), the open one marked. Another tree chosen opens: one held here as it
 * was (edits not sent stay), one never opened here loaded through the
 * gateway; the choice is remembered and the event stream follows it. Import
 * and managing trees stay away, one quiet line instead. Invented data only
 * (the Pýchavkovi of Mlýnky, the computer Pracovna). `STROM_SHOTS_DIR` set:
 * screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const HROT = '7b2e3d4f-5c6a-4b7c-9d8e-0f1a2b3c4d5e';
const MATR = '8c3f4e5a-6d7b-4c8d-8e9f-1a2b3c4d5e6f';
/** About 30 characters (the German check). */
const LONG_TREE = 'Pýchavkovi z Mlýnků a Hrotova';
const LONG_PC = 'Arbeitszimmer-Rechner im Dachgeschoss';

const SURNAME: Record<string, string> = { [PYCH]: 'Pýchavka', [HROT]: 'Hrotek', [MATR]: 'Mlynář' };

function ged(id: string): string {
    const surname = SURNAME[id] ?? 'Pýchavka';
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 24 NOV 2026', `1 _STROM_TREE ${id}`, '1 _STROM_HEAD 3c7a9e1f05b2',
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', `1 NAME Jan /${surname}/`, '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', `1 NAME Josef /${surname}/`, '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

/**
 * The research behind the gateway: three trees (one in the archive), each status with its persons and what
 * works and waits there; `statusNames` the research's own names (its status's `tree.name`), else the pairing's.
 */
function research(gw: FakeGateway, trees: { id: string; name: string; archive: boolean }[], statusNames: Record<string, string> = {}): void {
    gw.trees = trees;
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    const rows: Record<string, { persons: number; working: unknown[]; waiting: unknown[] }> = {
        [PYCH]: { persons: 412, working: [{ person: 'P0001', task: 'T0001' }], waiting: [] },
        [HROT]: { persons: 186, working: [], waiting: [{ id: 'W1' }, { id: 'W2' }, { id: 'W3' }] },
        [MATR]: { persons: 1204, working: [], waiting: [] },
    };
    gw.onTunnel = (req, device) => {
        const tree = gw.trees.find(t => t.id === req.tree) ?? gw.trees[0];
        if (req.p === 'status') {
            const row = rows[tree.id] ?? { persons: 3, working: [], waiting: [] };
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway'], tree: { id: tree.id, name: statusNames[tree.id] ?? tree.name }, head: '3c7a9e1f05b2',
                    persons: row.persons, working: row.working, waiting: row.waiting, queue: [], links: [],
                    accepts: { mode: 'research', sync: { auto: 'off' } },
                    device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] },
                },
            };
        }
        if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged(tree.id) };
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

/** Paired through the QR code's address, the tree chosen in the chooser and open. */
async function pairAndChoose(page: Page, gw: FakeGateway, nth: number, person: string): Promise<void> {
    await page.goto(gw.pairCode().url);
    const rows = page.locator('#device-boot .device-tree-row');
    await expect(rows).toHaveCount(gw.trees.length, { timeout: 20000 });
    await rows.nth(nth).click();
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.person-card', { hasText: person }).first()).toBeVisible({ timeout: 15000 });
}

const gedAsked = (gw: FakeGateway, id: string): number => gw.tunnelled.filter(t => t.p === 'tree.ged' && t.tree === id).length;
const chosen = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('strom-device-tree'));

/** The switcher opened: the list on a tablet and a computer, the sheet on a phone. */
async function openTrees(page: Page): Promise<Locator> {
    await page.locator('.tree-switcher-btn').click();
    const phone = (page.viewportSize()?.width ?? 1440) <= 640 || (page.viewportSize()?.height ?? 900) <= 500;
    const box = phone ? page.locator('.bottom-sheet-menu') : page.locator('#tree-switcher-dropdown.active');
    await expect(box).toBeVisible();
    return box;
}

const treeRows = (box: Locator): Locator => box.locator('.device-tree-item');

/** A changed person's first name (an edit not sent to the research). */
async function renameJosef(page: Page, to: string): Promise<void> {
    await page.evaluate((name) => {
        const s = window as unknown as { Strom: { DataManager: { getData(): { persons: Record<string, { firstName: string }> }; updatePerson(id: never, p: never): void }; TreeRenderer: { render(): void } } };
        const dm = s.Strom.DataManager;
        const id = Object.entries(dm.getData().persons).find(([, p]) => p.firstName === 'Josef')?.[0];
        if (!id) throw new Error('no Josef');
        dm.updatePerson(id as never, { firstName: name } as never);
        s.Strom.TreeRenderer.render();
    }, to);
}

/**
 * Nothing wider than the window and nothing over anything: the page, the box, each row's name (an ellipsis,
 * inside its row, never under its ✓ or its second line), the quiet line inside the box.
 */
async function expectFits(page: Page, box: Locator): Promise<void> {
    const m = await box.evaluate((root) => {
        const r = (el: Element) => el.getBoundingClientRect();
        const over = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
        const bad: string[] = [];
        const rb = r(root);
        if (rb.left < -0.5 || rb.right > window.innerWidth + 0.5) bad.push('box outside the window');
        if (root.scrollWidth > root.clientWidth + 0.5) bad.push('box scrolls sideways');
        const rows = [...root.querySelectorAll<HTMLElement>('.device-tree-item')];
        rows.forEach((row, i) => {
            const rr = r(row);
            const name = row.querySelector<HTMLElement>('.device-tree-name')!;
            const sub = row.querySelector<HTMLElement>('.device-tree-sub')!;
            const check = row.querySelector<HTMLElement>('.tree-item-check');
            if (!inside(r(name), rr)) bad.push(`row ${i}: name outside its row`);
            if (!inside(r(sub), rr)) bad.push(`row ${i}: second line outside its row`);
            if (over(r(name), r(sub))) bad.push(`row ${i}: name over its second line`);
            if (check && check.innerHTML && over(r(name), r(check))) bad.push(`row ${i}: name under the check`);
            if (getComputedStyle(name).textOverflow !== 'ellipsis') bad.push(`row ${i}: name without an ellipsis`);
            for (const el of sub.querySelectorAll<HTMLElement>('*')) if (!inside(r(el), rr)) bad.push(`row ${i}: ${el.className || el.tagName} outside`);
            if (rows[i + 1] && over(rr, r(rows[i + 1]))) bad.push(`row ${i} over row ${i + 1}`);
        });
        for (const q of root.querySelectorAll<HTMLElement>('.bottom-sheet-quiet, .tree-switcher-quiet, .tree-switcher-head')) {
            if (!inside(r(q), rb)) bad.push(`${q.className} outside the box`);
            if (q.scrollWidth > q.clientWidth + 0.5) bad.push(`${q.className} scrolls`);
        }
        return { page: document.documentElement.scrollWidth - window.innerWidth, bad };
    });
    expect(m.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.bad).toEqual([]);
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

const TREES = [
    { id: PYCH, name: 'Pýchavkovi', archive: false },
    { id: HROT, name: 'Hrotkovi z Hrotova', archive: false },
    { id: MATR, name: 'Mlýnky – farní matrika', archive: true },
];

test.describe('en', () => {
    test.use({ locale: 'en-US' });

    test('the switcher offers the research\'s trees: another one opens and is remembered, the stream follows; a tree held here keeps its edits', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw, TREES, { [PYCH]: 'Pýchavkovi z Mlýnků' });
        await pairAndChoose(page, gw, 0, 'Josef');
        expect(await chosen(page)).toBe(PYCH);

        // the list: its heading, every tree of the pairing, the open one marked and named by the research's status
        let box = await openTrees(page);
        await expect(box.locator('#tree-switcher-device-head')).toHaveText('Research trees');
        const rows = treeRows(box);
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.device-tree-name')).toHaveText('Pýchavkovi z Mlýnků');
        await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
        await expect(rows.nth(0)).toHaveClass(/active/);
        await expect(rows.nth(1).locator('.device-tree-name')).toHaveText('Hrotkovi z Hrotova');
        await expect(rows.nth(2).locator('.device-tree-name')).toHaveText('Mlýnky – farní matrika');
        // each row as in the chooser: persons, what works or waits, the archive's label
        await expect(rows.nth(0)).toContainText('412 people');
        await expect(rows.nth(0).locator('.phone-dot.is-on')).toHaveCount(1);
        await expect(rows.nth(1)).toContainText('186 people');
        await expect(rows.nth(1).locator('.research-count-badge')).toHaveText('3');
        await expect(rows.nth(2).locator('.research-sync-tag')).toHaveText('Strom archive');
        // the computer's things stay away: one quiet line
        await expect(box.locator('#tree-switcher-not-here')).toContainText('New tree, import and managing trees are on the computer with the research.');
        await expect(box.locator('#tree-switcher-import')).toHaveCount(0);
        await expect(box.getByText('Manage trees')).toHaveCount(0);
        // the empty tree of the app's own first start is not a research's tree
        await expect(box.getByText('My tree')).toHaveCount(0);

        // an edit not sent in the open tree, then another tree: loaded through the gateway, remembered, the stream of it
        await renameJosef(page, 'Josefík');
        await expect(page.locator('.person-card', { hasText: 'Josefík' }).first()).toBeVisible();
        expect(gedAsked(gw, HROT)).toBe(0);
        await rows.nth(1).click();
        await expect(page.locator('.person-card', { hasText: 'Hrotek' }).first()).toBeVisible({ timeout: 15000 });
        expect(gedAsked(gw, HROT)).toBe(1);
        await expect.poll(() => chosen(page)).toBe(HROT);
        await expect.poll(() => gw.streamQueries.at(-1)?.get('tree'), { timeout: 15000 }).toBe(HROT);
        await expect(page.locator('#current-tree-name')).toHaveText('Hrotkovi z Hrotova');

        // the phone's sheet: "Research trees", the open one marked now, the one left named by the pairing
        await page.setViewportSize({ width: 390, height: 844 });
        box = await openTrees(page);
        await expect(box.locator('.bottom-sheet-menu-title')).toHaveText('Research trees');
        await expect(treeRows(box)).toHaveCount(3);
        await expect(treeRows(box).nth(1)).toHaveClass(/active/);
        await expect(treeRows(box).nth(0).locator('.device-tree-name')).toHaveText('Pýchavkovi');
        await expect(box.locator('.bottom-sheet-quiet')).toContainText('New tree, import and managing trees are on the computer with the research.');
        await expect(box.getByText('Import…')).toHaveCount(0);
        await expect(box.getByText('Manage trees')).toHaveCount(0);

        // back to the first tree: the one held here, never loaded again, its edit still there
        const pychBefore = gedAsked(gw, PYCH);
        await treeRows(box).nth(0).click();
        await expect(page.locator('.person-card', { hasText: 'Josefík' }).first()).toBeVisible({ timeout: 15000 });
        expect(gedAsked(gw, PYCH)).toBe(pychBefore);
        await expect.poll(() => chosen(page)).toBe(PYCH);
        await expect.poll(() => gw.streamQueries.at(-1)?.get('tree'), { timeout: 15000 }).toBe(PYCH);

        // remembered: the next start opens it, with the edit
        await page.reload();
        await expect(page.locator('.person-card', { hasText: 'Josefík' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
    });

    test('the list follows a change of the language', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await seeds(page);
        research(gw, TREES);
        await pairAndChoose(page, gw, 1, 'Hrotek');
        let box = await openTrees(page);
        await expect(box.locator('#tree-switcher-device-head')).toHaveText('Research trees');
        await expect(treeRows(box).nth(0)).toContainText('412 people');
        await page.keyboard.press('Escape');
        await page.evaluate(() => (window as unknown as { Strom: { UI: { setLanguage(l: never): void } } }).Strom.UI.setLanguage('cs' as never));
        box = await openTrees(page);
        await expect(box.locator('#tree-switcher-device-head')).toHaveText('Stromy výzkumu');
        await expect(treeRows(box).nth(0)).toContainText('412 osob');
        await expect(treeRows(box).nth(1).locator('.device-tree-state')).toContainText('čeká');
        await expect(treeRows(box).nth(2).locator('.research-sync-tag')).toHaveText('Archiv Stromu');
        await expect(box.locator('#tree-switcher-not-here')).toContainText('Nový strom, import a správa stromů jsou na počítači s výzkumem.');
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 844 });
        box = await openTrees(page);
        await expect(box.locator('.bottom-sheet-menu-title')).toHaveText('Stromy výzkumu');
        await expect(treeRows(box).nth(1)).toContainText('186 osob');
    });
});

test.describe('de', () => {
    test.use({ locale: 'de-DE' });

    test('a long name: the list and the sheet fit at 1440, 1024, 390 and a phone held sideways, light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw, [
            { id: PYCH, name: LONG_TREE, archive: false },
            { id: HROT, name: 'Hrotkovi z Hrotova', archive: false },
            { id: MATR, name: 'Mlýnky – farní matrika', archive: true },
        ]);
        gw.computer = { name: '127.0.0.1', label: LONG_PC };
        await pairAndChoose(page, gw, 0, 'Josef');
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
                await page.setViewportSize(size);
                const box = await openTrees(page);
                await expect(treeRows(box)).toHaveCount(3);
                await expect(treeRows(box).nth(0).locator('.device-tree-name')).toHaveText(LONG_TREE);
                await expect(treeRows(box).nth(0)).toContainText('412 Personen');
                await expect(treeRows(box).nth(2).locator('.research-sync-tag')).toHaveText('Strom-Archiv');
                const head = size.width <= 640 || size.height <= 500 ? box.locator('.bottom-sheet-menu-title') : box.locator('#tree-switcher-device-head');
                await expect(head).toHaveText('Stammbäume der Forschung');
                await expectFits(page, box);
                if (size.width === 390 || size.width === 1440) await shot(page, `d3-stromy-vyzkumu-de-${size.width}-${scheme === 'light' ? 'svetle' : 'tmave'}`);
                await page.keyboard.press('Escape');
                await expect(box).toBeHidden();
            }
        }
    });
});
