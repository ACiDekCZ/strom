import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, the other way round: a hypothesis says a person
 * off the tree (Ondřej, with his wife Libuše and son Zdeněk) is the child of
 * a family in it (Bohumil + Hedvika, parents of Pavel and Věra). Shown, his
 * family stands under the parents as one more child, as ghosts with a
 * virtual line; the row's switch takes it away, Find goes to it; a record
 * kept in the older shape (kind 'child', anchored at the child) is drawn and
 * stored anew as kind 'parent'; a row switched on that nothing in the tree
 * leads to is not counted as on and says so. Invented data only
 * (e2e/fixtures/research-hypothesis-reverse.ged, research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-reverse.ged', 'utf-8');
const GED_LINKS = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; coParent?: string; on?: boolean };
/** Version A of H0048: Ondřej the son of Bohumil and Hedvika. */
const A: Rec = { hypo: 'H0048', variant: 'A', kind: 'parent', anchor: 'P0010', coParent: 'P0011', island: ['P0200'] };
/** The same, as the app kept it before: anchored at the child off the tree, the parents as the island. */
const OLD_A: Rec = { hypo: 'H0048', variant: 'A', kind: 'child', anchor: 'P0200', island: ['P0010', 'P0011'] };
/** A chained link without its base: Tomáš's father, Tomáš himself is only in the view through H0022. */
const CHAINED: Rec = { hypo: 'H0030', variant: 'A', kind: 'child', anchor: 'P0128', island: ['P0150'] };

async function setup(page: Page, ged = GED, first = 'Pavel'): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate((t) => window.Strom.UI.openGedcomText(t), ged);
    await expect(card(page, first).first()).toBeVisible();
}

/** Store records (persons by their research numbers) and focus `focus`. */
async function store(page: Page, records: Rec[], focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)?.id ?? refn;
        const links = records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            ...(r.coParent ? { coParentId: byRefn(r.coParent) } : {}),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }));
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(links));
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, focus });
}

/** The stored records, persons by their research numbers. */
const stored = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    const treeId = S.DataManager.getCurrentTreeId()!;
    const refn = (id: string) => S.DataManager.getAllPersons().find(p => p.id === id)?.refn ?? id;
    const raw = JSON.parse(localStorage.getItem(`strom-view-links:${treeId}`) ?? '[]') as Array<{ kind: string; anchorId: string; coParentId?: string; islandIds: string[]; on: boolean }>;
    return raw.map(r => ({ kind: r.kind, anchor: refn(r.anchorId), coParent: r.coParentId ? refn(r.coParentId) : undefined, island: r.islandIds.map(refn), on: r.on }));
});

const treeState = (page: Page) => page.evaluate(() => ({
    data: JSON.stringify(window.Strom.DataManager.getData()),
    undo: window.Strom.DataManager.canUndo(),
}));

const ghosts = (page: Page) => page.locator('.person-card.view-ghost');
const panel = (page: Page) => page.locator('#view-links-panel');
const row = (page: Page, hypo: string) => panel(page).locator(`.view-links-row[data-hypo="${hypo}"]`);
const virtual = (page: Page) => page.locator('#tree-lines [data-view="virtual"][data-view-hypo="H0048"]');

async function openList(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openViewLinksPanel());
    await expect(panel(page)).toBeVisible();
}

/** The middle of a card's box (its row; the focus card is drawn larger around it). */
const top = async (page: Page, name: string) => {
    const b = (await card(page, name).boundingBox())!;
    return Math.round(b.y + b.height / 2);
};

test.describe('linked in the view only: a child off the tree under parents in it', () => {
    test('shown from Bohumil\'s menu: Ondřej\'s family stands as ghosts, Ondřej in his siblings\' row, a virtual line; the data stay as they were', async ({ page }) => {
        await setup(page);
        const before = await treeState(page);
        await expect(ghosts(page)).toHaveCount(0);

        await card(page, 'Bohumil').click();
        const menu = page.locator('.context-menu.person-menu');
        await expect(menu).toBeVisible();
        // Two versions: the second level lists them.
        await menu.locator('[data-menu="view-link-show-menu"]').click();
        await page.locator('.context-submenu [data-action="view-link-show:H0048:A"]').click();

        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await expect(card(page, 'Libuše')).toHaveClass(/view-ghost/);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0048"][data-view-variant="A"]')).not.toHaveCount(0);
        for (const name of ['Pavel', 'Věra', 'Bohumil', 'Hedvika']) {
            await expect(card(page, name)).not.toHaveClass(/view-ghost/);
        }
        // One more child of Bohumil and Hedvika: the same row as Pavel and Věra.
        expect(Math.abs(await top(page, 'Ondřej') - await top(page, 'Pavel'))).toBeLessThanOrEqual(2);
        expect(Math.abs(await top(page, 'Ondřej') - await top(page, 'Věra'))).toBeLessThanOrEqual(2);
        await expect(virtual(page)).not.toHaveCount(0);
        expect(await stored(page)).toEqual([{ kind: 'parent', anchor: 'P0010', coParent: 'P0011', island: ['P0200'], on: true }]);

        // Not a change of the tree.
        expect(await treeState(page)).toEqual(before);
    });

    test('the row\'s switch in the list takes the family away and brings it back; "1 of 1 on"', async ({ page }) => {
        await setup(page);
        await store(page, [A]);
        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await openList(page);
        const r = row(page, 'H0048');
        await expect(r).toHaveAttribute('data-state', 'draw');
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('1 of 1 on');
        await expect(r.locator('.view-links-row__status--unreached')).toHaveCount(0);

        await r.getByRole('switch').click();
        await expect(r.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        await expect(ghosts(page)).toHaveCount(0);
        await expect(virtual(page)).toHaveCount(0);
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('0 of 1 on');

        await r.getByRole('switch').click();
        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('1 of 1 on');
    });

    test('Find in the row goes to the family in the tree: Ondřej and Bohumil in view', async ({ page }) => {
        await setup(page);
        await store(page, [A]);
        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await openList(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('timeline'));
        await row(page, 'H0048').locator('.view-links-row__find').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await expect(card(page, 'Ondřej')).toBeInViewport();
        await expect(card(page, 'Bohumil')).toBeInViewport();
    });

    test('a record kept in the older shape is drawn and stored anew as a "parent" link', async ({ page }) => {
        await setup(page);
        const before = await treeState(page);
        await store(page, [OLD_A]);
        await expect(card(page, 'Ondřej')).toHaveClass(/view-ghost/);
        await expect(card(page, 'Libuše')).toHaveClass(/view-ghost/);
        expect(Math.abs(await top(page, 'Ondřej') - await top(page, 'Věra'))).toBeLessThanOrEqual(2);
        await expect(virtual(page)).not.toHaveCount(0);
        await expect.poll(() => stored(page)).toEqual([{ kind: 'parent', anchor: 'P0010', coParent: 'P0011', island: ['P0200'], on: true }]);
        expect(await treeState(page)).toEqual(before);
    });

    test('a row switched on that nothing in the tree leads to: not counted, says why', async ({ page }) => {
        await setup(page, GED_LINKS, 'Karel');
        await store(page, [CHAINED]);
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(ghosts(page)).toHaveCount(0);
        await openList(page);
        const r = row(page, 'H0030');
        await expect(r).toHaveAttribute('data-state', 'draw');
        await expect(r.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
        await expect(r.locator('.view-links-row__status--unreached')).toHaveText('Not shown: nothing in the tree leads to it');
        await expect(panel(page).locator('.view-links-panel__master-sub')).toHaveText('0 of 1 on');
    });
});
