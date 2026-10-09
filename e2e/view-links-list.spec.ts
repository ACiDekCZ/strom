import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, keeping track: the indicator over the view (× turns
 * every shown link off, the notice turns them on), the list (each row's
 * switch, Find, ×; the main switch; "Remove invalid" / "Remove all" with Undo
 * in the panel; every reason a row no longer holds; the empty state), the
 * entries in the Research menu and in Settings → Tree, the notice after a load
 * of the research made some invalid (once), "Restore the state before loading"
 * drawing them again, another window of the tree following, the live bridge's
 * say, and the indicator and list on a phone, a tablet and a phone sideways.
 * Invented data only (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

/** The same tree without anything a variant would connect: the feature does not show. */
const GED_PLAIN = GED.split('\n').filter(l => !/^3 _LINK\b|^4 _(PERS|FAM|PAR) |^3 _VAR |^2 _VAR /.test(l)).join('\n');

async function setup(page: Page, ged = GED): Promise<void> {
    await openApp(page);
    await page.evaluate((t) => window.Strom.UI.openGedcomText(t), ged);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean };
/** Drawn: Václav's parents (version B of H0022). */
const B: Rec = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
/** Drawn, switched off: Rozálie's earlier husband. */
const MARTIN: Rec = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'], on: false };
/** Real: decided for B, and the tree has Rozálie's parents. */
const REAL: Rec = { hypo: 'H0026', variant: 'B', kind: 'child', anchor: 'P0011', island: ['P0012', 'P0013'] };
/** Invalid: the hypothesis was abandoned. */
const CANCELLED: Rec = { hypo: 'H0027', variant: 'A', kind: 'child', anchor: 'P0001', island: ['P0150'] };

/** Store records (persons by their research numbers; a missing one keeps the number as its id) and focus Karel. */
async function store(page: Page, records: Rec[], focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)?.id ?? refn;
        const links = records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }));
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(links));
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, focus });
}

/** The stored records. */
async function records(page: Page): Promise<Array<{ hypo: string; variant: string; on: boolean }>> {
    return page.evaluate(() => {
        const treeId = window.Strom.DataManager.getCurrentTreeId()!;
        const raw = JSON.parse(localStorage.getItem(`strom-view-links:${treeId}`) ?? '[]') as Array<{ hypo: string; variant: string; on: boolean }>;
        return raw.map(r => ({ hypo: r.hypo, variant: r.variant, on: r.on }));
    });
}

const rawRecords = (page: Page) => page.evaluate(() =>
    localStorage.getItem(`strom-view-links:${window.Strom.DataManager.getCurrentTreeId()!}`));

const master = (page: Page) => page.evaluate(() =>
    localStorage.getItem(`strom-view-links-master:${window.Strom.DataManager.getCurrentTreeId()!}`) !== 'false');

const pill = (page: Page) => page.locator('#view-links-pill');
const panel = (page: Page) => page.locator('#view-links-panel');
const row = (page: Page, hypo: string) => panel(page).locator(`.view-links-row[data-hypo="${hypo}"]`);
const ghosts = (page: Page) => page.locator('.person-card.view-ghost');

async function openList(page: Page): Promise<void> {
    await pill(page).locator('.view-links-pill__open').click();
    await expect(panel(page)).toBeVisible();
}

const treeState = (page: Page) => page.evaluate(() => ({
    data: JSON.stringify(window.Strom.DataManager.getData()),
    undo: window.Strom.DataManager.canUndo(),
}));

/** Boxes overlap (by more than a pixel). */
function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

/** What a tap at a point hits, by its class (the 44px target can reach beyond the box drawn). */
const hitAt = (page: Page, x: number, y: number) => page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return hit?.closest('button')?.className ?? '';
}, { x, y });

test.describe('the indicator', () => {
    test('a tree without what a variant connects: no indicator, no Research menu entry, no settings row, no list', async ({ page }) => {
        await setup(page, GED_PLAIN);
        await store(page, [B]);
        await expect(card(page, 'Václav').first()).toBeVisible();
        await expect(pill(page)).toHaveCount(0);
        await page.locator('#research-menu-btn').click();
        await expect(page.locator('#research-menu')).toHaveClass(/active/);
        await expect(page.locator('#research-item-view-links')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#view-links-settings')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
        await page.evaluate(() => window.Strom.UI.openViewLinksPanel());
        await expect(panel(page)).toHaveCount(0);
    });

    test('"Linked in the view only · n" while the view draws them; × turns them all off, the notice turns them on — no change of the tree', async ({ page }) => {
        await setup(page);
        await store(page, [B, MARTIN, REAL]);
        await expect(ghosts(page)).toHaveCount(5);
        const before = await treeState(page);
        await expect(pill(page)).toBeVisible();
        await expect(pill(page).locator('.view-links-pill__label--long')).toHaveText('Linked in the view only ·');
        await expect(pill(page).locator('.view-links-pill__count')).toHaveText('1');
        await expect(pill(page).locator('.view-links-pill__open')).toHaveAttribute('aria-label', 'Linked in the view only · 1. Open the list');
        // Its place: the top of the view, under the toolbar and clear of the focus bar.
        const box = (await pill(page).boundingBox())!;
        expect(overlaps(box, (await page.locator('.toolbar').boundingBox())!)).toBe(false);

        await pill(page).locator('.view-links-pill__close').click();
        await expect(pill(page)).toHaveCount(0);
        await expect(ghosts(page)).toHaveCount(0);
        expect(await master(page)).toBe(false);
        const toast = page.locator('.toast[data-kind="view-links-off"]');
        await expect(toast).toContainText('Shown links turned off');
        // The rows keep their switches.
        expect(await records(page)).toEqual([
            { hypo: 'H0022', variant: 'B', on: true }, { hypo: 'H0024', variant: 'A', on: false }, { hypo: 'H0026', variant: 'B', on: true },
        ]);
        await toast.getByRole('button', { name: 'Turn on' }).click();
        await expect(ghosts(page)).toHaveCount(5);
        await expect(pill(page)).toBeVisible();
        expect(await master(page)).toBe(true);
        expect(await treeState(page)).toEqual(before);
    });

    test('with the evidence pill up, the indicator stands under it (gap 8); not in the fan or the timeline', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await expect(pill(page)).toBeVisible();
        const alone = Math.round((await pill(page).boundingBox())!.y);
        await page.evaluate(() => window.Strom.UI.showEvidenceLevels());
        const evidence = page.locator('#evidence-pill');
        await expect(evidence).toBeVisible();
        await expect.poll(async () => {
            const e = (await evidence.boundingBox())!;
            const p = (await pill(page).boundingBox())!;
            return Math.round(p.y - (e.y + e.height));
        }).toBe(8);
        await page.evaluate(() => window.Strom.UI.endEvidenceHighlight());
        await expect.poll(async () => Math.round((await pill(page).boundingBox())!.y)).toBe(alone);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('timeline'));
        await expect(pill(page)).toHaveCount(0);
    });
});

test.describe('the list', () => {
    test('the notice after opening the research steps aside of the list at once, never across its footer', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await setup(page);
        await store(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        const notice = page.locator('.toast', { hasText: 'Opened the research' });
        await expect(notice).toBeVisible();
        // Its own coming in done: the notice stands in the middle, where the list will open.
        await page.waitForTimeout(400);
        const boxes = await page.evaluate(() => {
            const box = (node: Element | null) => {
                const r = node!.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            };
            const toast = document.querySelector('.toast');
            const before = box(toast);
            window.Strom.UI.researchActionViewLinks();
            // The first frame with the list open: the notice already beside it.
            return { before, toast: box(toast), panel: box(document.getElementById('view-links-panel')), foot: box(document.querySelector('.view-links-panel__foot')) };
        });
        expect(boxes.before.x + boxes.before.width).toBeGreaterThan(boxes.panel.x);
        expect(overlaps(boxes.toast, boxes.panel)).toBe(false);
        expect(overlaps(boxes.toast, boxes.foot)).toBe(false);
        // The list's footer takes a click while the notice is still up.
        await expect(notice).toBeVisible();
        await panel(page).getByRole('button', { name: 'Remove all' }).click();
        await expect(panel(page).locator('.view-links-panel__toast')).toContainText('Removed: parents of Václav Horák');
    });

    test('opens from the indicator: rows drawn (by place, on and off), then real, then invalid; Esc closes back to the indicator', async ({ page }) => {
        await setup(page);
        await store(page, [CANCELLED, REAL, MARTIN, B]);
        await openList(page);
        await expect(panel(page)).toHaveAttribute('role', 'dialog');
        await expect(panel(page).locator('.view-links-panel__title')).toHaveText('Linked in the view only');
        await expect(panel(page).locator('.view-links-panel__close')).toBeFocused();
        // Václav's parents stand above Rozálie's partner? Both at the parents' row: left to right (Václav first).
        await expect(panel(page).locator('.view-links-row')).toHaveCount(4);
        expect(await panel(page).locator('.view-links-row').evaluateAll(rows => rows.map(r => `${(r as HTMLElement).dataset.hypo}:${(r as HTMLElement).dataset.state}`)))
            .toEqual(['H0022:draw', 'H0024:draw', 'H0026:real', 'H0027:invalid']);
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('1 of 2 on');

        const b = row(page, 'H0022');
        await expect(b.locator('.view-links-row__who')).toHaveText('Parents of Václav Horák');
        await expect(b.locator('.view-links-row__claim')).toContainText('H0022 · version B: syn Jakuba Horáka a Marie Pokorné');
        await expect(b.locator('.view-links-row__people')).toHaveText('+ 5 people');
        await expect(b.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
        await expect(b.getByRole('button', { name: 'Find Parents of Václav Horák in the tree' })).toBeVisible();
        await expect(b.getByRole('button', { name: 'Remove: Parents of Václav Horák' })).toBeVisible();
        await expect(row(page, 'H0024').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        await expect(row(page, 'H0024').locator('.view-links-row__who')).toHaveText('Partner of Rozálie Dvořáčková');
        // Real: an outline instead of the switch, its state, Find, ×.
        const real = row(page, 'H0026');
        await expect(real.getByRole('switch')).toHaveCount(0);
        await expect(real.locator('.view-links-row__outline')).toBeVisible();
        await expect(real.locator('.view-links-row__status')).toHaveText('Now linked for real');
        await expect(real.locator('.view-links-row__find')).toBeVisible();
        // Invalid: the reason, no Find, ×.
        const bad = row(page, 'H0027');
        await expect(bad.locator('.view-links-row__status')).toHaveText('No longer valid: hypothesis cancelled');
        await expect(bad.locator('.view-links-row__find')).toHaveCount(0);
        await expect(bad.locator('.view-links-row__remove')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await expect(pill(page).locator('.view-links-pill__open')).toBeFocused();
    });

    test('a row\'s switch stops drawing it (the row stays) and draws it again; the main switch turns all off, the indicator goes, rows fade but stay usable', async ({ page }) => {
        await setup(page);
        await store(page, [B, MARTIN]);
        await openList(page);
        const before = await treeState(page);
        const sw = row(page, 'H0022').getByRole('switch');
        await sw.click();
        await expect(ghosts(page)).toHaveCount(0);
        await expect(pill(page)).toHaveCount(0);
        await expect(row(page, 'H0022')).toBeVisible();
        await expect(row(page, 'H0022').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        await expect(row(page, 'H0022').getByRole('switch')).toBeFocused();
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('0 of 2 on');
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: false }, { hypo: 'H0024', variant: 'A', on: false }]);
        await row(page, 'H0022').getByRole('switch').click();
        await expect(ghosts(page)).toHaveCount(5);
        await expect(pill(page)).toBeVisible();

        // The main switch.
        const main = panel(page).locator('.view-links-panel__master-switch');
        await expect(main).toHaveAttribute('aria-checked', 'true');
        await expect(main).toHaveAccessibleName('Show in the tree');
        await main.click();
        await expect(pill(page)).toHaveCount(0);
        await expect(ghosts(page)).toHaveCount(0);
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('All off · each row keeps its setting');
        await expect(panel(page).locator('.view-links-panel__list')).toHaveClass(/is-master-off/);
        expect(await row(page, 'H0022').evaluate(r => getComputedStyle(r).opacity)).toBe('0.5');
        // A row switch still works (nothing drawn while the main switch is off).
        await row(page, 'H0024').getByRole('switch').click();
        await expect(row(page, 'H0024').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
        await expect(ghosts(page)).toHaveCount(0);
        await panel(page).locator('.view-links-panel__master-switch').click();
        await expect(ghosts(page)).toHaveCount(6);
        await expect(pill(page).locator('.view-links-pill__count')).toHaveText('2');
        expect(await treeState(page)).toEqual(before);
    });

    test('× removes a row at once, "Removed: …" with Undo in the panel brings back exactly the list before', async ({ page }) => {
        await setup(page);
        await store(page, [B, MARTIN, CANCELLED]);
        await openList(page);
        const before = await rawRecords(page);
        await row(page, 'H0022').getByRole('button', { name: 'Remove: Parents of Václav Horák' }).click();
        await expect(row(page, 'H0022')).toHaveCount(0);
        await expect(ghosts(page)).toHaveCount(0);
        await expect(pill(page)).toHaveCount(0);
        const toast = panel(page).locator('.view-links-panel__toast');
        await expect(toast).toContainText('Removed: parents of Václav Horák');
        await expect(toast).toHaveAttribute('role', 'status');
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(row(page, 'H0022')).toBeVisible();
        await expect(ghosts(page)).toHaveCount(5);
        expect(await rawRecords(page)).toBe(before);
        await expect(toast).toHaveCount(0);
    });

    test('"Remove invalid" only with invalid rows, removes only those; "Remove all" empties the list (Undo again); the empty list says how it works', async ({ page }) => {
        await setup(page);
        await store(page, [B, MARTIN]);
        await openList(page);
        await expect(panel(page).getByRole('button', { name: 'Remove invalid' })).toHaveCount(0);
        await expect(panel(page).getByRole('button', { name: 'Remove all' })).toBeVisible();
        await page.keyboard.press('Escape');

        await store(page, [B, MARTIN, CANCELLED, REAL]);
        await openList(page);
        await panel(page).getByRole('button', { name: 'Remove invalid' }).click();
        expect((await records(page)).map(r => r.hypo)).toEqual(['H0022', 'H0024', 'H0026']);
        await expect(panel(page).locator('.view-links-panel__toast')).toContainText('Removed: parent of Karel Horák');
        await expect(panel(page).getByRole('button', { name: 'Remove invalid' })).toHaveCount(0);

        const before = await rawRecords(page);
        await panel(page).getByRole('button', { name: 'Remove all' }).click();
        expect(await records(page)).toEqual([]);
        await expect(panel(page).locator('.view-links-panel__toast')).toContainText('Removed: 3 links');
        await expect(panel(page).locator('.view-links-row')).toHaveCount(0);
        await expect(panel(page).locator('.view-links-panel__foot')).toBeHidden();
        await expect(panel(page).locator('.view-links-panel__empty-text')).toHaveText(
            'Nothing yet. A family outside the tree that a research hypothesis would link can be shown in its place.');
        await panel(page).locator('.view-links-panel__toast').getByRole('button', { name: 'Undo' }).click();
        expect(await rawRecords(page)).toBe(before);
        await expect(panel(page).locator('.view-links-row')).toHaveCount(3);

        await store(page, []);
        await expect(panel(page).locator('.view-links-row')).toHaveCount(0);
        const how = panel(page).getByRole('button', { name: 'How it works' });
        await expect(how).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page).locator('.view-links-panel__howto-text')).toBeHidden();
        await how.click();
        await expect(how).toHaveAttribute('aria-expanded', 'true');
        await expect(panel(page).locator('.view-links-panel__howto-text')).toContainText('from the open stub above a card, from the card\'s menu (Show as linked)');
    });

    test('every reason a row no longer holds is said', async ({ page }) => {
        await setup(page);
        // Václav gets a real mother (hasParents for B); Jan becomes Antonín's father (C's family joined).
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const by = (r: string) => dm.getAllPersons().find(p => p.refn === r)!.id;
            const mother = dm.createPerson({ firstName: 'Eva', lastName: 'Horáková', gender: 'female' });
            dm.addParentChild(mother.id, by('P0010'));
            dm.addParentChild(by('P0130'), by('P0012'));
        });
        await store(page, [
            B,
            { hypo: 'H0022', variant: 'C', kind: 'child', anchor: 'P0010', island: ['P0130'] },
            { hypo: 'H0026', variant: 'A', kind: 'child', anchor: 'P0011', island: ['P0150'] },
            CANCELLED,
            { hypo: 'H0099', variant: 'A', kind: 'child', anchor: 'P0001', island: ['P0150'] },
            { hypo: 'H0024', variant: 'B', kind: 'partners', anchor: 'P0011', island: ['P0140'] },
            { hypo: 'H0030', variant: 'A', kind: 'child', anchor: 'P0128', island: ['P0777'] },
        ]);
        await page.evaluate(() => window.Strom.UI.openViewLinksPanel());
        await expect(panel(page)).toBeVisible();
        // One record per hypothesis: H0022 C is the one kept (the later); B is checked on its own below.
        const said = await panel(page).locator('.view-links-row__status--invalid').allTextContents();
        expect(said.sort()).toEqual([
            'No longer valid: family already in the tree',
            'No longer valid: hypothesis cancelled',
            'No longer valid: hypothesis decided otherwise',
            'No longer valid: hypothesis is gone',
            'No longer valid: person no longer in the tree',
            'No longer valid: version without a link',
        ]);
        await store(page, [B]);
        await expect(row(page, 'H0022').locator('.view-links-row__status')).toHaveText('No longer valid: person already has parents');
        // Its name quieter than a valid row's.
        await expect(row(page, 'H0022')).toHaveClass(/view-links-row--invalid/);
    });

    test('Find goes to the place in the tree: from the timeline back to the Family view at the person', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await openList(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('timeline'));
        await row(page, 'H0022').locator('.view-links-row__find').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
        await expect(ghosts(page)).toHaveCount(5);
        await expect(card(page, 'Václav').first()).toBeInViewport();
    });
});

test.describe('the entries', () => {
    test('the Research menu: "Linked in the view only (n)" opens the list; Settings → Tree: "… · n · Open" under the research edge', async ({ page }) => {
        await setup(page);
        await store(page, [B, MARTIN]);
        await page.locator('#research-menu-btn').click();
        const item = page.locator('#research-item-view-links');
        await expect(item).toHaveText('Linked in the view only (1)');
        await item.click();
        await expect(panel(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('#research-menu-btn')).toBeFocused();

        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const host = page.locator('#view-links-settings');
        await expect(host).toBeVisible();
        await expect(host.locator('.settings-name')).toHaveText('Linked in the view only · 1');
        // Right under "Research edge".
        expect(await host.evaluate(h => h.previousElementSibling?.id)).toBe('research-edge-settings');
        await host.getByRole('button', { name: 'Open' }).click();
        await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
        await expect(panel(page)).toBeVisible();
    });
});

test.describe('after a load of the research', () => {
    test('a load that makes a shown link invalid says so once ("List" opens it); "Restore the state before loading" draws it again', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        // The research decided H0022 for version A.
        const decided = GED.replace(/1 _STROM_HEAD \w+/, '1 _STROM_HEAD 1111111111111111111111111111111111111111')
            .replace(/(_STROM_HYPO H0022\n2 TITL [^\n]*\n2 STAT) open/g, '$1 decided\n2 _CHOSEN A');
        const load = async (ged: string): Promise<void> => {
            const done = page.evaluate((t) => window.Strom.UI.openGedcomText(t), ged);
            await page.getByRole('dialog', { name: 'Load the research version?' }).getByRole('button', { name: 'Load', exact: true }).click();
            await done;
        };
        await load(decided);
        await expect(ghosts(page)).toHaveCount(0);
        // The load's own notice first ("Restore the state before loading"); the view links' notice after it.
        const loaded = page.locator('.toast:not([data-kind])');
        await expect(loaded).toContainText('Restore the state before loading');
        await expect(page.locator('.toast[data-kind="view-links-invalid"]')).toHaveCount(0);
        await page.evaluate(() => document.querySelector('.toast')?.remove());
        const told = page.locator('.toast[data-kind="view-links-invalid"]');
        await expect(told).toContainText('1 view-only link is no longer valid');
        await told.getByRole('button', { name: 'List' }).click();
        await expect(row(page, 'H0022').locator('.view-links-row__status')).toHaveText('No longer valid: hypothesis decided otherwise');
        // The record stays.
        expect(await records(page)).toEqual([{ hypo: 'H0022', variant: 'B', on: true }]);

        // The state before the load: drawn again, the list in step.
        await page.evaluate(() => window.Strom.UI.researchRestoreBeforeLoad(window.Strom.TreeManager.getActiveTreeId()!));
        // (The focus depth the load shortened stays as it is: Václav's parents and brother come back.)
        await expect.poll(() => ghosts(page).count()).toBeGreaterThanOrEqual(3);
        await expect(pill(page)).toBeVisible();
        await expect(row(page, 'H0022')).toHaveAttribute('data-state', 'draw');

        // The same change loaded again: not said a second time.
        await page.evaluate(() => document.querySelector('.toast')?.remove());
        await load(decided.replace(/1111111111/, '2222222222'));
        await expect(ghosts(page)).toHaveCount(0);
        await page.evaluate(() => document.querySelector('.toast')?.remove());
        await page.waitForTimeout(300);
        await expect(page.locator('.toast[data-kind="view-links-invalid"]')).toHaveCount(0);
    });
});

test.describe('keeping in step', () => {
    test('another window of the same tree changes the records or the main switch: this one draws it at once', async ({ page, context }) => {
        await setup(page);
        await store(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        await openList(page);
        const other = await context.newPage();
        await other.goto(page.url());
        await expect(card(other, 'Karel').first()).toBeVisible();
        await expect(other.locator('#view-links-pill')).toBeVisible();
        // Turned off there.
        await other.locator('#view-links-pill .view-links-pill__close').click();
        await expect(ghosts(page)).toHaveCount(0);
        await expect(pill(page)).toHaveCount(0);
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('All off · each row keeps its setting');
        // On again, and the row removed there.
        await other.locator('.toast[data-kind="view-links-off"]').getByRole('button', { name: 'Turn on' }).click();
        await expect(ghosts(page)).toHaveCount(5);
        await other.evaluate(() => {
            const id = window.Strom.DataManager.getCurrentTreeId()!;
            localStorage.removeItem(`strom-view-links:${id}`);
        });
        await expect(ghosts(page)).toHaveCount(0);
        await expect(panel(page).locator('.view-links-row')).toHaveCount(0);
        await other.close();
    });

    test('a live bridge has its say: without hypothesis.links in its features the feature goes, with it it comes back', async ({ page }) => {
        await setup(page);
        await store(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        await page.evaluate(() => {
            const UI = window.Strom.UI as unknown as { researchStatusOf: (id: string) => unknown; viewLinksBridgeChanged: () => void; __features: string[] };
            UI.__features = ['material.list'];
            UI.researchStatusOf = () => ({ features: UI.__features });
            UI.viewLinksBridgeChanged();
        });
        await expect(ghosts(page)).toHaveCount(0);
        await expect(pill(page)).toHaveCount(0);
        await page.evaluate(() => {
            const UI = window.Strom.UI as unknown as { viewLinksBridgeChanged: () => void; __features: string[] };
            UI.__features = ['material.list', 'hypothesis.links'];
            UI.viewLinksBridgeChanged();
        });
        await expect(ghosts(page)).toHaveCount(5);
        await expect(pill(page)).toBeVisible();
    });
});

/** Every label in the list and the indicator fits its box (German is the longest). */
async function textsFit(scope: Locator): Promise<string[]> {
    return scope.evaluate(root => {
        const bad: string[] = [];
        for (const node of root.querySelectorAll<HTMLElement>('button, span, h2, p')) {
            if (node.getClientRects().length === 0 || node.children.length > 0) continue;
            if (node.classList.contains('view-links-row__claim')) continue;  // clamped to two lines on purpose
            if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow !== 'visible') bad.push(node.textContent ?? '');
            const r = node.getBoundingClientRect();
            if (r.right > window.innerWidth + 0.5 || r.left < -0.5) bad.push(`off screen: ${node.textContent}`);
        }
        return bad;
    });
}

async function german(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setLanguage('de'));
    await expect(page.locator('#research-menu-btn, .toolbar')).not.toHaveCount(0);
}

for (const [name, viewport] of [
    ['phone 360', { width: 360, height: 740 }],
    ['tablet', { width: 820, height: 1180 }],
    ['phone sideways', { width: 740, height: 360 }],
] as const) {
    test.describe(name, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the indicator covers no control, its targets are 44px, the list\'s controls too; German fits', async ({ page }) => {
            await setup(page);
            await store(page, [B, MARTIN, REAL, CANCELLED]);
            await expect(ghosts(page)).toHaveCount(5);
            await german(page);
            await expect(pill(page)).toBeVisible();
            const box = (await pill(page).boundingBox())!;
            // No control under it.
            const controls = await page.locator('.toolbar button:visible, .bottom-bar button:visible, .zoom-controls button:visible, .focus-controls button:visible, .control-block button:visible').all();
            for (const c of controls) {
                const b = await c.boundingBox();
                if (b) expect(overlaps(box, b), `covers ${await c.getAttribute('class')}`).toBe(false);
            }
            const sideways = name === 'phone sideways';
            const open = pill(page).locator('.view-links-pill__open');
            const close = pill(page).locator('.view-links-pill__close');
            if (sideways) {
                // Only the icon and the number, at the top right, no ×.
                await expect(close).toBeHidden();
                await expect(pill(page).locator('.view-links-pill__label--long')).toBeHidden();
                await expect(pill(page).locator('.view-links-pill__label--short')).toBeHidden();
                expect(box.x + box.width).toBeGreaterThan(viewport.width - 24);
            } else if (name === 'phone 360') {
                await expect(pill(page).locator('.view-links-pill__label--short')).toHaveText('Nur Ansicht ·');
                await expect(pill(page).locator('.view-links-pill__label--long')).toBeHidden();
                expect(Math.round(box.height)).toBe(36);
            }
            // 44px targets: a tap 21px above and below the middle still hits the control.
            for (const target of sideways ? [open] : [open, close]) {
                const b = (await target.boundingBox())!;
                const cls = (await target.getAttribute('class'))!;
                expect(b.width).toBeGreaterThanOrEqual(sideways || target === open ? 44 : 28);
                expect(await hitAt(page, b.x + b.width / 2, b.y + b.height / 2 - 21)).toBe(cls);
                expect(await hitAt(page, b.x + b.width / 2, b.y + b.height / 2 + 21)).toBe(cls);
            }
            if (!sideways) {
                const b = (await close.boundingBox())!;
                expect(await hitAt(page, b.x + b.width / 2 - 21, b.y + b.height / 2)).toMatch(/view-links-pill__(close|open)/);
            }
            expect(await textsFit(pill(page))).toEqual([]);

            await open.click();
            await expect(panel(page)).toBeVisible();
            const p = (await panel(page).boundingBox())!;
            if (name === 'tablet') {
                expect(Math.round(p.width)).toBe(420);
            } else {
                await expect(panel(page)).toHaveClass(/view-links-panel--sheet/);
                await expect(panel(page)).toHaveAttribute('aria-modal', 'true');
                expect(p.height).toBeGreaterThan(viewport.height - 20);
                if (sideways) expect(Math.round(p.width)).toBeLessThanOrEqual(560);
                else expect(Math.round(p.width)).toBe(viewport.width);
            }
            // Every control of the list: at least 44 × 44 (switches 44 × 26 drawn in a 44px target).
            const small = await panel(page).evaluate(root => [...root.querySelectorAll<HTMLElement>('button')]
                .filter(b => b.getClientRects().length > 0)
                .map(b => ({ c: b.className, r: b.getBoundingClientRect() }))
                .filter(x => x.r.height < 44 || (x.r.width < 44 && !x.c.includes('link-button')))
                .map(x => `${x.c} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`));
            expect(small).toEqual([]);
            await expect(panel(page).locator('.view-links-panel__title')).toHaveText('Nur in der Ansicht verbunden');
            await expect(panel(page).getByRole('button', { name: 'Ungültige entfernen' })).toBeVisible();
            await expect(panel(page).getByRole('button', { name: 'Alle entfernen' })).toBeVisible();
            expect(await textsFit(panel(page))).toEqual([]);
            // On a phone "Find" stands on its own line under the text, and the keyboard stays in the sheet.
            if (name !== 'tablet') {
                await panel(page).locator('.view-links-panel__close').focus();
                await page.keyboard.press('Shift+Tab');
                await expect(panel(page).locator('.view-links-panel__remove-all')).toBeFocused();
                await page.keyboard.press('Tab');
                await expect(panel(page).locator('.view-links-panel__close')).toBeFocused();
                const text = (await row(page, 'H0022').locator('.view-links-row__text').boundingBox())!;
                const find = (await row(page, 'H0022').locator('.view-links-row__find').boundingBox())!;
                expect(find.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
            }
        });
    });
}
