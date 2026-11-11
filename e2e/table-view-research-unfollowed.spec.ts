import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll } from './research-bridge.js';

/**
 * The Table view without following (spec 057 §7.4, variant G): while the
 * research's bridge answers the regular ask, Agent and Research tasks show
 * the agent's work and the queue from its status as while following (no
 * dashed "–"), the Agent chip filters, and they follow the next answer; an
 * empty queue said by the bridge leaves the cells empty; the bridge down,
 * the cells are "–" as before. Invented data (the Fíškovi of Čapkov); the
 * bridge is answered by page.route; a fixed clock.
 */

const NOW = new Date('2026-11-10T10:30:00Z');
const AGENT = { who: 'agent-matriky', since: '2026-11-10T10:20:00Z', task: 'Křest Jana Fíška', person: 'P0003' };
const QUEUE = [{ id: 'T0101', text: 'Sňatek Josefa', state: 'next', person: 'P0001' }];

async function openTable(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.openTableView('r:research'));
}

const cellOf = (page: Page, refn: string, col: string) => page.evaluate(({ refn, col }) => {
    const p = Object.values(window.Strom.DataManager.getData().persons).find(x => x.refn === refn)!;
    const at = document.querySelector<HTMLElement>(`#table-container .tv-headrow [data-col="${col}"]`)?.getAttribute('aria-colindex');
    const el = document.querySelector<HTMLElement>(`#table-container .tv-body .tv-row[data-key="p:${p.id}"] [role="gridcell"][aria-colindex="${at}"]`);
    return el?.textContent?.trim() ?? null;
}, { refn, col });

test.describe('the Table without following (spec 057 §7.4)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the bridge answers: the agent and the queue from its status, following the next answer; down: "–"', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openResearch(page);
        const bridge = await fakeBridge(page, { statusExtra: { working: [AGENT], queue: QUEUE } });
        await poll(page);
        await openTable(page);
        expect(await page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
        await expect.poll(() => cellOf(page, 'P0003', 'rAgent')).toBe('working: Křest Jana Fíška');
        await expect.poll(() => cellOf(page, 'P0001', 'rAgent')).toBe('in the queue');
        await expect.poll(() => cellOf(page, 'P0001', 'rTasks')).toBe('1 · next no. 1 in the queue');
        // The columns look as while following: no dashed "live" tag in their heads.
        await expect(page.locator('#table-container .tv-headrow [data-col="rAgent"] .tv-live-tag')).toHaveCount(0);
        // The status line names where the cells come from: the running research, not following it.
        await expect(page.locator('#table-container .tv-status-res')).toHaveText('● Agent and tasks from the running research');

        // The next answer: nobody at work, the queue empty — empty cells, not "–".
        bridge.statusExtra = { working: [], queue: [] };
        await poll(page);
        await expect.poll(() => cellOf(page, 'P0003', 'rAgent')).toBe('');
        await expect.poll(() => cellOf(page, 'P0001', 'rTasks')).toBe('');

        // The bridge does not answer: as before ("–").
        bridge.down = true;
        await poll(page);
        await expect.poll(() => cellOf(page, 'P0003', 'rAgent')).toBe('–');
        await expect.poll(() => cellOf(page, 'P0001', 'rTasks')).toBe('–');
        await expect(page.locator('#table-container .tv-headrow [data-col="rAgent"] .tv-live-tag')).toHaveCount(1);
        await expect(page.locator('#table-container .tv-status-res')).not.toHaveText(/running research|live/);
    });
});
