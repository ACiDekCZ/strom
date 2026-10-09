import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, drawn: a family outside the tree that a variant
 * of an open hypothesis would link stands in the Family and Descendants views
 * as if linked. The cards and lines carry the hooks of their look (class
 * view-ghost / view-virtual, data-view, data-view-hypo); the tree's data, its
 * counts, the other views and the outputs never see it. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'research-hypothesis-links.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** Show H0022 B (and optionally more), focus Karel. */
async function show(page: Page, records: Array<{ hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean }>, master = true): Promise<void> {
    await page.evaluate(({ records, master }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        const links = records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }));
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(links));
        if (master) localStorage.removeItem(`strom-view-links-master:${treeId}`);
        else localStorage.setItem(`strom-view-links-master:${treeId}`, 'false');
        S.TreeRenderer.setFocus(byRefn('P0001'));
    }, { records, master });
}

const B = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
const PARTNER = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'] };

async function setup(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await dropFile(page, GED);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

test.describe('linked in the view only: layout', () => {
    test('the shown family stands as ghosts, its link line is virtual, the data stay as they were', async ({ page }) => {
        await setup(page);
        const before = await page.evaluate(() => ({
            data: JSON.stringify(window.Strom.DataManager.getData()),
            undo: window.Strom.DataManager.canUndo(),
            count: document.getElementById('focus-person-count')?.textContent ?? '',
        }));
        await show(page, [B, PARTNER]);

        const ghosts = page.locator('.person-card.view-ghost');
        await expect(ghosts).toHaveCount(6);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0022"][data-view-variant="B"]')).toHaveCount(5);
        await expect(page.locator('.person-card.view-ghost[data-view-hypo="H0024"]')).toHaveCount(1);
        for (const name of ['Jakub', 'Marie', 'Josef', 'Tomáš', 'Anna', 'Martin']) {
            await expect(card(page, name)).toHaveClass(/view-ghost/);
        }
        for (const name of ['Karel', 'Václav', 'Rozálie', 'Antonín', 'Ludmila']) {
            await expect(card(page, name)).not.toHaveClass(/view-ghost/);
        }
        await expect(page.locator('#tree-lines [data-view="virtual"][data-view-hypo="H0022"]')).not.toHaveCount(0);
        await expect(page.locator('#tree-lines .view-virtual[data-view-hypo="H0024"]')).not.toHaveCount(0);
        await expect(page.locator('#tree-lines line.view-ghost[data-view="ghost"]')).not.toHaveCount(0);

        const after = await page.evaluate(() => ({
            data: JSON.stringify(window.Strom.DataManager.getData()),
            undo: window.Strom.DataManager.canUndo(),
            count: document.getElementById('focus-person-count')?.textContent ?? '',
        }));
        // Not a change of the tree: same data, nothing to undo, the counts are the tree's.
        expect(after.data).toBe(before.data);
        // The focus depth reaches the shown generations (Karel → Václav → Jakub → Tomáš).
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthUp())).toBe(3);
        expect(after.undo).toBe(before.undo);
        expect(after.count).toBe(before.count);
    });

    test('the outputs and the people of the view leave the shown family out; the minimap draws it', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);
        const r = await page.evaluate(() => {
            const S = window.Strom;
            const jakub = S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!.id;
            const vaclav = S.DataManager.getAllPersons().find(p => p.refn === 'P0010')!.id;
            return {
                poster: S.TreeRenderer.getPosterLayout().positions.has(jakub),
                posterVaclav: S.TreeRenderer.getPosterLayout().positions.has(vaclav),
                minimap: S.TreeRenderer.getPosterLayout({ includeView: true }).positions.has(jakub),
                visible: S.TreeRenderer.getVisiblePersonIds().has(jakub),
                focused: Object.keys(S.TreeRenderer.getFocusedData()?.persons ?? {}).includes(jakub),
                flagged: S.TreeRenderer.getPosterLayout().connections.some(c => c.view || c.drops.some(d => d.view)),
            };
        });
        expect(r).toEqual({ poster: false, posterVaclav: true, minimap: true, visible: false, focused: false, flagged: false });
    });

    test('only the Family and Descendants views draw it; the main switch and a record switched off draw nothing', async ({ page }) => {
        await setup(page);
        await show(page, [B]);
        await expect(page.locator('.person-card.view-ghost')).toHaveCount(5);

        for (const mode of ['timeline', 'fan'] as const) {
            await page.evaluate((mode) => window.Strom.TreeRenderer.setViewMode(mode), mode);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewLayer())).toBeNull();
            await expect(page.locator('.view-ghost')).toHaveCount(0);
        }
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants'));
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find(p => p.refn === 'P0125')!.id);
        });
        // Jakub's descendants reach Václav and Karel through the shown link.
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(card(page, 'Jakub')).toHaveClass(/view-ghost/);
        await expect(page.locator('#tree-lines [data-view="virtual"]')).not.toHaveCount(0);

        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('family'));
        await show(page, [B], false);
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(page.locator('.view-ghost')).toHaveCount(0);
        await show(page, [{ ...B, on: false }]);
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(page.locator('.view-ghost')).toHaveCount(0);
    });
});
