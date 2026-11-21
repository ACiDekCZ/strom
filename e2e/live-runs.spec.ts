import { test, expect, Page } from '@playwright/test';
import { directionRow, launchedLinks, openOverview, overview } from './live-directions-bridge';
import { RUN_DIRECTIONS, RUN_FEATURES, followRuns } from './live-runs-bridge';

/**
 * A direction's own run (spec 126 U10 §1, §2): "Put an agent on this
 * direction" in the direction's detail (AI + terminal) and its ⋯ beside the
 * conversation, held with the reason when it cannot start (paused, nothing
 * in its queue, the most runs at once), "Agent at work" with "In Now ›" for a
 * direction with its run, nothing to start on a phone, and the dialog before
 * the start: its agent, its queue, usage adding up, the link with
 * `research=` and `agent=`, and Now's row while it starts. An older research
 * (no `run.lines`) shows none of it. Invented data only ("Kubíčkovi a Malí").
 */

const dialog = (page: Page) => page.locator('#queue-work-modal [role="dialog"]');
const runBox = (page: Page, id: string) => directionRow(page, id).locator('.research-direction__run');

/** The research's directions with `patch` merged into the one of `id`. */
const directions = (id: string, patch: Record<string, unknown>): Record<string, unknown>[] =>
    RUN_DIRECTIONS.map(d => d.id === id ? { ...d, ...patch } : d);

async function unfold(page: Page, id: string): Promise<void> {
    await directionRow(page, id).locator('.research-direction__head').click();
    await expect(directionRow(page, id).locator('.research-direction__detail')).toBeVisible();
}

async function openMenu(page: Page, id: string): Promise<void> {
    await directionRow(page, id).locator('.research-direction__more').click();
    await expect(page.locator('#live-direction-menu')).toBeVisible();
}

test.describe('a direction\'s own run', () => {
    test('the detail offers it with AI + terminal and its sentence; ⋯ has the run before the conversation, each with its hint', async ({ page }) => {
        await followRuns(page);
        await openOverview(page);
        await unfold(page, 'G0002');
        const btn = runBox(page, 'G0002').locator('[data-do="run"]');
        await expect(btn).toHaveText(/Put an agent on this direction/);
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(1);
        await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
        await expect(runBox(page, 'G0002').locator('.research-direction__run-why'))
            .toHaveText('The agent takes this direction\'s tasks by itself (7 in the queue), in a new terminal window.');

        await openMenu(page, 'G0002');
        const items = page.locator('#live-direction-menu .research-direction-menu__item');
        const order = await items.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.do));
        expect(order.indexOf('run')).toBeGreaterThan(-1);
        expect(order.indexOf('run')).toBe(order.indexOf('work') - 1);
        const run = page.locator('#live-direction-menu [data-do="run"]');
        await expect(run.locator('.research-direction-menu__hint')).toHaveText('The agent takes the direction\'s tasks by itself');
        await expect(run.locator('.research-ai-badge')).toHaveCount(1);
        await expect(run.locator('.research-open-mark')).toHaveCount(1);
        await expect(page.locator('#live-direction-menu [data-do="work"] .research-direction-menu__hint'))
            .toHaveText('A conversation with the agent about the direction in the terminal');
    });

    test('a direction with its run: "Agent at work" with "In Now ›" in its row and detail, no run in ⋯; In Now lights its block', async ({ page }) => {
        await followRuns(page);
        await openOverview(page);
        const meta = directionRow(page, 'G0001').locator('.research-direction__meta');
        await expect(meta.locator('.research-direction__run-meta')).toHaveText('Agent at work: Claude');
        await expect(meta.locator('.research-direction__in-now')).toHaveText('In Now ›');
        await unfold(page, 'G0001');
        await expect(runBox(page, 'G0001').locator('[data-do="run"]')).toHaveCount(0);
        await expect(runBox(page, 'G0001').locator('.research-direction__run-state')).toHaveText(/^Agent at work · Claude · since \d{1,2}:\d{2}/);
        await openMenu(page, 'G0001');
        await expect(page.locator('#live-direction-menu [data-do="run"]')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await runBox(page, 'G0001').locator('.research-direction__in-now').click();
        const block = overview(page).locator('#ov-sec-now [data-run="run-1a07"]');
        await expect(block).toHaveClass(/is-flash/);
        await expect(block).toBeFocused();
    });

    test('held, never hidden: paused, nothing in its queue, the most runs at once (with Settings ›)', async ({ page }) => {
        await followRuns(page, { researches: directions('G0002', { canStart: false, why: 'limit' }) });
        await openOverview(page);
        await unfold(page, 'G0003');
        const paused = runBox(page, 'G0003').locator('[data-do="run"]');
        await expect(paused).toHaveAttribute('aria-disabled', 'true');
        await expect(runBox(page, 'G0003').locator('.research-direction__run-why')).toHaveText('The direction is paused.');
        // Restart stays beside it.
        await expect(directionRow(page, 'G0003').locator('[data-do="resume"]')).toBeVisible();
        await openMenu(page, 'G0003');
        const item = page.locator('#live-direction-menu [data-do="run"]');
        await expect(item).toHaveAttribute('aria-disabled', 'true');
        await expect(item.locator('.research-direction-menu__hint')).toHaveText('The direction is paused.');
        // A held item does nothing.
        await item.click({ force: true });
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await unfold(page, 'G0002');
        await expect(runBox(page, 'G0002').locator('[data-do="run"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(runBox(page, 'G0002').locator('.research-direction__run-why'))
            .toHaveText('2 agents are working; the settings allow no more. Settings ›');
        await expect(runBox(page, 'G0002').locator('.research-direction__run-settings')).toHaveText('Settings ›');
        await runBox(page, 'G0002').locator('[data-do="run"]').click({ force: true });
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
    });

    test('nothing in the direction\'s queue: held with its reason', async ({ page }) => {
        await followRuns(page, { researches: directions('G0002', { canStart: false, why: 'empty' }) });
        await openOverview(page);
        await unfold(page, 'G0002');
        await expect(runBox(page, 'G0002').locator('[data-do="run"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(runBox(page, 'G0002').locator('.research-direction__run-why')).toHaveText('Nothing in the direction\'s queue.');
    });

    test('a phone offers nothing to start, the row says the state only', async ({ page }) => {
        await followRuns(page, { size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await expect(directionRow(page, 'G0001').locator('.research-direction__run-meta')).toHaveText('Agent at work: Claude');
        await expect(directionRow(page, 'G0001').locator('.research-direction__in-now')).toHaveCount(0);
        await expect(overview(page).locator('[data-do="run"], .research-direction__run')).toHaveCount(0);
    });

    test('an older research (no run.lines): no run, the conversation without a hint, the row as before', async ({ page }) => {
        await followRuns(page, { features: RUN_FEATURES.filter(f => !f.startsWith('run.')) });
        await openOverview(page);
        await expect(overview(page).locator('.research-direction__run-meta, .research-direction__in-now')).toHaveCount(0);
        await unfold(page, 'G0002');
        await expect(runBox(page, 'G0002')).toHaveCount(0);
        await openMenu(page, 'G0002');
        await expect(page.locator('#live-direction-menu [data-do="run"]')).toHaveCount(0);
        await expect(page.locator('#live-direction-menu [data-do="work"] .research-direction-menu__hint')).toHaveCount(0);
    });

    test('without the work link: nothing to start, a running direction still says so', async ({ page }) => {
        await followRuns(page, { links: [] });
        await openOverview(page);
        await unfold(page, 'G0002');
        await expect(runBox(page, 'G0002')).toHaveCount(0);
        await openMenu(page, 'G0002');
        await expect(page.locator('#live-direction-menu [data-do="run"]')).toHaveCount(0);
        await expect(directionRow(page, 'G0001').locator('.research-direction__run-meta')).toHaveCount(1);
    });
});

test.describe('the dialog before a direction\'s run', () => {
    test('from the detail: the direction, its agent, its queue, usage adding up; Esc gives the focus back', async ({ page }) => {
        await followRuns(page);
        await openOverview(page);
        await unfold(page, 'G0002');
        await runBox(page, 'G0002').locator('[data-do="run"]').click();
        const d = dialog(page);
        await expect(d.locator('.queue-work__head-kicker')).toHaveText('Put an agent on the direction');
        await expect(d.locator('#queue-work-title')).toHaveText(/Malí z Horní Vsi\s+G0002/);
        await expect(d.locator('.queue-work__agent-label')).toHaveText('Agent');
        await expect(d.locator('.queue-work__agent [role="radio"]')).toHaveText(['Claude (default)', 'Codex']);
        await expect(d.locator('[data-agent="claude"]')).toHaveAttribute('aria-checked', 'true');
        await expect(d.locator('.queue-work__agent-kept')).toHaveText('The choice is kept for this direction.');
        await expect(d.locator('#queue-work-auto-hint'))
            .toHaveText('The agent takes one task of this direction after another as long as the subscription limit allows.');
        // Its queue: the direction's first task, not the whole queue's.
        await expect(d.locator('.queue-work__first-task')).toHaveText('T0391 Křest Ludmily Malé');
        await expect(d.locator('.queue-work__adds')).toHaveText('2 agents are already working. Subscription usage adds up.');
        await expect(d.locator('.queue-work__confirm')).toHaveText(/^The research terminal confirms the start\./);
        const open = d.locator('#queue-work-open');
        await expect(open).toHaveText(/Start/);
        await expect(open.locator('.research-ai-badge')).toHaveCount(1);
        await expect(open.locator('.research-open-mark')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        await expect(runBox(page, 'G0002').locator('[data-do="run"]')).toBeFocused();
    });

    test('from ⋯ with Codex: the link carries the direction and the agent, Now says it starts, Codex is chosen next time', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-11-21T10:30:00Z') });
        await followRuns(page);
        await openOverview(page);
        await openMenu(page, 'G0002');
        await page.locator('#live-direction-menu [data-do="run"]').click();
        const d = dialog(page);
        await d.locator('[data-agent="codex"]').click();
        await expect(d.locator('[data-agent="codex"]')).toHaveAttribute('aria-checked', 'true');
        await d.locator('#queue-work-open').click();
        // The page's clock is the test's: "Opening the agent…" its moment, then the dialog goes.
        await page.clock.runFor(1000);
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        await expect.poll(() => launchedLinks(page)).toEqual([
            expect.stringMatching(/^strom-research:\/\/work\?tree=[^&]+&do=loop&research=G0002&agent=codex$/),
        ]);
        const starting = overview(page).locator('#ov-sec-now .live-now-starting[data-start-scope="G0002"]');
        await expect(starting).toHaveText(/Starting… · Malí z Horní Vsi \(G0002\)/);
        await expect(directionRow(page, 'G0002').locator('.research-direction__run-meta')).toHaveText('starting…');
        // No run of G0002 within 30 s: its own question; the action is free again and remembers Codex.
        await page.clock.runFor(31_000);
        await expect(starting).toHaveText(/Did the direction's run not start\? · Malí z Horní Vsi \(G0002\)/);
        await unfold(page, 'G0002');
        await runBox(page, 'G0002').locator('[data-do="run"]').click();
        await expect(dialog(page).locator('[data-agent="codex"]')).toHaveAttribute('aria-checked', 'true');
    });

    test('de at 1440: a long name wraps inside the dialog, nothing overflows', async ({ page }) => {
        const long = 'Malí z Horní Vsi a jejich příbuzní v Dolní Lhotě, v Horní Vsi a v okolních obcích na panství';
        await followRuns(page, { researches: directions('G0002', { name: long }) });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openOverview(page);
        await unfold(page, 'G0002');
        await runBox(page, 'G0002').locator('[data-do="run"]').click();
        const d = dialog(page);
        await expect(d.locator('.queue-work__head-kicker')).toHaveText('Agent auf Richtung ansetzen');
        await expect(d.locator('#queue-work-open')).toHaveText(/Starten/);
        const over = await d.evaluate((m) => [m, ...m.querySelectorAll<HTMLElement>('.modal-header, .queue-work__head, h2, .queue-work__agent, .queue-work__foot')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className || e.tagName));
        expect(over).toEqual([]);
    });
});
