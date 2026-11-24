import { test, expect, Page } from '@playwright/test';
import { ago, followManaged, openOverview, overview } from './live-directions-bridge';
import { RUN_FEATURES, RUN_WORKING, followRuns } from './live-runs-bridge';

/**
 * The agent's own browser saves a book's images (`working[].saving`, feature `working.saving`): the row at
 * work says "agent saving images (k of n)" beside its task — in the live panel, in Now of the overview (one
 * at work, a row per line, a run's block) and under the directions; no bar (`of` grows). Without the
 * feature, or without the field, the rows as before. Invented data only.
 */

const SAVING = { recordset: 'B0007', saved: 3, of: 5 };
const ONE = { who: 'agent-matriky', since: ago(6), task: 'Matrika Nové Hradiště 1784–1830', person: 'P0012', research: 'G0001', session: 'N0132' };
const TWO = { who: 'agent-scitani', since: ago(3), task: 'Sčítání lidu 1880', person: 'P0050', research: 'G0002', session: 'N0133' };
const TEXT = 'agent saving images (3 of 5)';
const nowRow = (page: Page, who: string) => overview(page).locator('.research-overview__now-row', { hasText: who });

test.describe('the agent saving images (working.saving)', () => {
    test('one at work: beside its task in the live panel and in Now', async ({ page }) => {
        await followManaged(page, { features: ['working.saving'], working: [{ ...ONE, saving: SAVING }] });
        await expect(page.locator('#live-panel .live-working .live-saving')).toHaveText(` · ${TEXT}`);
        await openOverview(page);
        const row = nowRow(page, 'agent-matriky');
        await expect(row.locator('.live-task')).toHaveText(` — ${ONE.task}`);
        await expect(row.locator('.live-saving')).toHaveText(` · ${TEXT}`);
        // No bar of any kind: the count only.
        await expect(row.locator('progress, [role="progressbar"]')).toHaveCount(0);
    });

    test('two at work: under its line in Now and under the directions', async ({ page }) => {
        await followManaged(page, { features: ['working.saving'], working: [{ ...ONE, saving: SAVING }, TWO] });
        const line = page.locator('#live-panel .live-line[data-direction="G0001"]');
        await expect(line.locator('.live-line__task')).toHaveText(`${ONE.task} · ${TEXT}`);
        await expect(page.locator('#live-panel .live-line[data-direction="G0002"] .live-saving')).toHaveCount(0);
        await openOverview(page);
        const rows = overview(page).locator('.research-overview__now-row--line');
        await expect(rows.filter({ hasText: 'agent-matriky' }).locator('.research-overview__now-line')).toHaveText(new RegExp(` — ${ONE.task} · ${TEXT.replace(/[()]/g, '\\$&')}$`));
        await expect(rows.filter({ hasText: 'agent-scitani' }).locator('.live-saving')).toHaveCount(0);
    });

    test('a run\'s block in Now: beside the task of its last step', async ({ page }) => {
        const working = RUN_WORKING.map((w, i) => i === 0 ? { ...w, saving: { recordset: 'B0012', saved: 0, of: 1 } } : w);
        await followRuns(page, { features: [...RUN_FEATURES, 'working.saving'], working });
        await openOverview(page);
        const block = overview(page).locator('.research-overview__run[data-run="run-8f2c"]');
        await expect(block.locator('.research-overview__run-task')).toHaveText('Vojtěch Kubíček — křest Vojtěcha Kubíčka · agent saving images (0 of 1)');
        await expect(overview(page).locator('.research-overview__run[data-run="run-1a07"] .live-saving')).toHaveCount(0);
    });

    test('an older research (no working.saving): the field is not read, the rows as before', async ({ page }) => {
        await followManaged(page, { features: ['working.helps'], working: [{ ...ONE, saving: SAVING }] });
        await expect(page.locator('#live-panel .live-working .live-task')).toHaveText(` — ${ONE.task}`);
        await expect(page.locator('#live-panel .live-saving')).toHaveCount(0);
        await openOverview(page);
        await expect(nowRow(page, 'agent-matriky').locator('.live-task')).toHaveText(` — ${ONE.task}`);
        await expect(overview(page).locator('.live-saving')).toHaveCount(0);
        await expect(overview(page)).not.toContainText('saving images');
    });

    test('a run\'s block of an older research: the step as before', async ({ page }) => {
        const working = RUN_WORKING.map((w, i) => i === 0 ? { ...w, saving: SAVING } : w);
        await followRuns(page, { working });
        await openOverview(page);
        await expect(overview(page).locator('.research-overview__run[data-run="run-8f2c"] .research-overview__run-task'))
            .toHaveText('Vojtěch Kubíček — křest Vojtěcha Kubíčka');
        await expect(overview(page).locator('.live-saving')).toHaveCount(0);
    });
});
