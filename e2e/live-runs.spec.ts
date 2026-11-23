import { test, expect, Locator, Page } from '@playwright/test';
import { UUID, directionRow, launchedLinks, openOverview, overview } from './live-directions-bridge';
import { RUNS, RUN_AGENTS_MANY, RUN_DIRECTIONS, RUN_FEATURES, RUN_WORKING, followRuns } from './live-runs-bridge';

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

const T = new Date('2026-11-21T10:30:00Z');
const at = (min: number): string => new Date(T.getTime() + min * 60_000).toISOString();
/** The page's clock text of an ISO time (the browser's own zone). */
const clockOf = (page: Page, iso: string) => page.evaluate(i => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(i)), iso);

/** The two runs of the sample with times of the test's clock, and G0002 waiting for the limit until `until` when asked. */
function runsAt(opts: { limitUntil?: string } = {}): Record<string, unknown>[] {
    const runs: Record<string, unknown>[] = RUNS.map((r, i) => ({ ...r, since: at(i === 0 ? -50 : -10) }));
    if (opts.limitUntil) {
        runs.push({ id: 'run-2c44', research: 'G0002', agent: 'codex', agentName: 'Codex', since: at(-30), state: 'paused',
            paused: { until: opts.limitUntil, reason: 'limit' }, session: 'N0143', sessions: 2 });
    }
    return runs;
}
const workingAt = (): Record<string, unknown>[] => RUN_WORKING.map((w, i) => ({ ...w, since: at(i === 0 ? -4 : -2) }));

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
        // The test's clock (not midnight in any zone the tests run in): the run's start shows as a time alone.
        await page.clock.setFixedTime(T);
        await followRuns(page, { runs: runsAt(), working: workingAt() });
        await openOverview(page);
        const meta = directionRow(page, 'G0001').locator('.research-direction__meta');
        await expect(meta.locator('.research-direction__run-meta')).toHaveText('Agent at work: Claude');
        await expect(meta.locator('.research-direction__in-now')).toHaveText('In Now ›');
        await unfold(page, 'G0001');
        await expect(runBox(page, 'G0001').locator('[data-do="run"]')).toHaveCount(0);
        await expect(runBox(page, 'G0001').locator('.research-direction__run-state')).toHaveText(new RegExp(`^Agent at work · Claude · since ${await clockOf(page, at(-10))}`));
        await openMenu(page, 'G0001');
        await expect(page.locator('#live-direction-menu [data-do="run"]')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await runBox(page, 'G0001').locator('.research-direction__in-now').click();
        const block = overview(page).locator('#ov-sec-now [data-run="run-1a07"]');
        await expect(block).toHaveClass(/is-flash/);
        await expect(block).toBeFocused();
    });

    test('a direction whose run waits for an archive says so in its row and detail, as Now does, never "Agent at work"', async ({ page }) => {
        await page.clock.setFixedTime(T);
        const until = at(45);
        const runs = runsAt().map(r => r.id === 'run-1a07' ? { ...r, state: 'paused', paused: { until, reason: 'archive' } } : r);
        await followRuns(page, { runs, working: workingAt() });
        await openOverview(page);
        const wait = `Claude · waiting for the archive until ${await clockOf(page, until)}`;
        const meta = directionRow(page, 'G0001').locator('.research-direction__meta');
        await expect(meta.locator('.research-direction__run-meta')).toHaveText(wait);
        await expect(meta.locator('.research-direction__in-now')).toHaveText('In Now ›');
        await expect(overview(page).locator('#ov-sec-now [data-run="run-1a07"] .research-overview__run-state'))
            .toHaveText(`waiting for the archive until ${await clockOf(page, until)}`);
        // The state tile counts it among the agents and says it waits (before: "2 agents working", nothing under it).
        const tile = overview(page).locator('.research-overview__summary .research-overview__cell').first();
        await expect(tile.locator('.research-overview__cell-value')).toHaveText('2 agents working');
        await expect(tile.locator('.research-overview__cell-sub')).toHaveText('1 waiting');
        // It looks waiting, as Now's state does: the warning colour, the dot yellow, never the working primary.
        const color = (l: Locator, prop: 'color' | 'backgroundColor' = 'color') => l.evaluate((e, p) => getComputedStyle(e)[p], prop);
        const token = (l: Locator, name: string) => l.evaluate((e, n) => {
            const probe = e.appendChild(document.createElement('i'));
            probe.style.color = getComputedStyle(e).getPropertyValue(n).trim();
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        }, name);
        // The arc beside the name stands still in the warning colour; a run at work spins it.
        const arc = directionRow(page, 'G0001').locator('.research-direction__head .agent-mark');
        await expect(arc).toHaveClass(/is-wait/);
        await expect(arc).not.toHaveClass(/agent-mark--spin/);
        expect(await arc.evaluate(e => getComputedStyle(e).borderTopColor)).toBe(await token(arc, '--warning'));
        const runMeta = meta.locator('.research-direction__run-meta');
        // Polled: a status redraws the row meanwhile.
        await expect.poll(async () => await color(runMeta) === await token(runMeta, '--warning-text')).toBe(true);
        await unfold(page, 'G0001');
        const state = runBox(page, 'G0001').locator('.research-direction__run-state');
        await expect(state).toHaveText(wait);
        await expect(state).toHaveClass(/is-wait/);
        await expect.poll(async () => await color(state) === await token(state, '--warning-text')).toBe(true);
        const dot = state.locator('.research-direction__run-dot');
        await expect.poll(async () => await color(dot, 'backgroundColor') === await token(state, '--warning')).toBe(true);
        expect(await color(dot, 'backgroundColor')).not.toBe(await token(state, '--primary'));
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

    for (const [why, text] of [
        ['noAgent', 'This computer has no agent installed that the research can start.'],
        ['oldRun', 'An agent started by an older version of the research is working on the tree; a direction\'s agent cannot start beside it. It can once that one ends.'],
        ['xyz', 'An agent cannot be put on this direction now.'],
    ] as const) {
        test(`held by the research (${why}): its sentence under the button and in ⋯`, async ({ page }) => {
            await followRuns(page, { researches: directions('G0002', { canStart: false, why }) });
            await openOverview(page);
            await unfold(page, 'G0002');
            await expect(runBox(page, 'G0002').locator('[data-do="run"]')).toHaveAttribute('aria-disabled', 'true');
            await expect(runBox(page, 'G0002').locator('.research-direction__run-why')).toHaveText(text);
            await openMenu(page, 'G0002');
            const item = page.locator('#live-direction-menu [data-do="run"]');
            await expect(item).toHaveAttribute('aria-disabled', 'true');
            await expect(item.locator('.research-direction-menu__hint')).toHaveText(text);
        });
    }

    test('the dialog open when the research holds the run: Start held, the sentence above it', async ({ page }) => {
        const b = await followRuns(page, { fastReconnect: true });
        await openOverview(page);
        await unfold(page, 'G0002');
        await runBox(page, 'G0002').locator('[data-do="run"]').click();
        const d = dialog(page);
        await expect(d.locator('#queue-work-open')).toBeEnabled();
        b.researches = directions('G0002', { canStart: false, why: 'oldRun' });
        await expect(d.locator('#queue-work-held')).toHaveText(
            'An agent started by an older version of the research is working on the tree; a direction\'s agent cannot start beside it. It can once that one ends.',
            { timeout: 10000 });
        await expect(d.locator('#queue-work-open')).toBeDisabled();
        b.researches = directions('G0002', { canStart: false, why: 'noAgent' });
        await expect(d.locator('#queue-work-held')).toHaveText('This computer has no agent installed that the research can start.', { timeout: 10000 });
    });

    test('de at 1440: the long sentence of an older run wraps inside ⋯, nothing overflows', async ({ page }) => {
        await followRuns(page, { researches: directions('G0002', { canStart: false, why: 'oldRun' }) });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openOverview(page);
        await openMenu(page, 'G0002');
        const menu = page.locator('#live-direction-menu');
        const hint = menu.locator('[data-do="run"] .research-direction-menu__hint');
        await expect(hint).toHaveText('Am Stammbaum arbeitet ein Agent, den eine ältere Forschungsversion gestartet hat; daneben startet kein Agent der Richtung. Das geht, sobald er fertig ist.');
        const over = await menu.evaluate(m => [m, ...m.querySelectorAll<HTMLElement>('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length
            + [...m.querySelectorAll<HTMLElement>('.research-direction-menu__hint')].filter(h => h.getBoundingClientRect().right > m.getBoundingClientRect().right + 0.5).length);
        expect(over).toBe(0);
        const box = await menu.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
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

/**
 * The runs in Now (spec 126 U10 §3, §4): a block per run, the general run
 * first, then the directions' runs in their order, each with its state, what
 * the general run skips, its own Finish and stop (by the run's id) and Stop
 * through the bridge (no mark); a run ended a moment ago stays a minute.
 */
const threeRunDirections = (): Record<string, unknown>[] => directions('G0002', { run: 'run-2c44', canStart: false, why: 'running', working: true });

const now = (page: Page) => overview(page).locator('#ov-sec-now');
const nowTitle = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-now"] .live-section__title');
const block = (page: Page, run: string) => now(page).locator(`.research-overview__run[data-run="${run}"]`);

test.describe('the runs in Now', () => {
    test('three runs: a block each in order, the wait with its time and no Finish, Skips on the general run only, the state tile', async ({ page }) => {
        await page.clock.install({ time: T });
        const until = at(180);
        await followRuns(page, { runs: runsAt({ limitUntil: until }), working: workingAt(), researches: threeRunDirections() });
        await openOverview(page);
        const t = await clockOf(page, until);
        await expect(now(page).locator('.research-overview__run')).toHaveCount(3);
        expect(await now(page).locator('.research-overview__run').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.run)))
            .toEqual(['run-8f2c', 'run-1a07', 'run-2c44']);
        await expect(nowTitle(page)).toHaveText('Now · 3 agents');

        const general = block(page, 'run-8f2c');
        await expect(general.locator('.research-overview__run-name')).toHaveText('Whole queue');
        await expect(general.locator('.live-line__glyph--queue')).toHaveCount(1);
        await expect(general.locator('.research-overview__run-state')).toHaveText('working');
        await expect(general.locator('.research-overview__run-note')).toContainText(['Skips: Kubíčkovi z Dolní Lhoty, Malí z Horní Vsi']);

        const g1 = block(page, 'run-1a07');
        await expect(g1.locator('.research-overview__run-name')).toHaveText('Kubíčkovi z Dolní Lhoty');
        await expect(g1.locator('.research-overview__run-code')).toHaveText('G0001');
        await expect(g1.locator('.research-overview__run-state')).toHaveText('working');
        await expect(g1.locator('.research-overview__run-meta')).toHaveText(new RegExp(`^Claude · since ${await clockOf(page, at(-10))}`));
        await expect(g1.locator('.research-overview__run-person')).toHaveText('Vojtěch Kubíček');
        await expect(g1.locator('.research-overview__finish')).toHaveCount(1);
        await expect(g1).not.toContainText('Skips');

        const g2 = block(page, 'run-2c44');
        await expect(g2.locator('.research-overview__run-state')).toHaveText(`waiting for the subscription limit until ${t}`);
        await expect(g2.locator('.research-overview__run-state')).toHaveClass(/is-wait/);
        await expect(g2.locator('.research-overview__finish')).toHaveCount(0);
        await expect(g2).not.toContainText('Skips');

        const tile = overview(page).locator('.research-overview__summary .research-overview__cell').first();
        await expect(tile.locator('.research-overview__cell-value')).toHaveText('3 agents working');
        await expect(tile.locator('.research-overview__cell-sub')).toHaveText(`1 waiting for the limit until ${t}`);
    });

    test('Finish and stop of G0001 names its run, not the first session; Stop goes through the bridge without a mark', async ({ page }) => {
        await page.clock.install({ time: T });
        const b = await followRuns(page, { runs: runsAt(), working: workingAt() });
        await openOverview(page);
        const g1 = block(page, 'run-1a07');
        const finish = g1.locator('.research-overview__finish');
        await expect(finish).toHaveAttribute('title', 'The agent writes up findings and closes the session');
        await expect(finish.locator('.research-open-mark')).toHaveCount(1);
        await finish.click();
        await expect.poll(() => launchedLinks(page)).toEqual([`strom-research://finish?tree=${UUID}&run=run-1a07`]);

        const stop = g1.locator('.research-overview__run-stop');
        await expect(stop).toHaveText('Stop');
        await expect(stop).toHaveAttribute('title', 'Finishes the task in progress and starts no other');
        await expect(stop.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        // Stop before Finish and stop, after Show in tree.
        expect(await g1.locator('.research-overview__run-actions > .link-button').evaluateAll(els => els.map(e => e.className.split(' ')[1])))
            .toEqual(['research-overview__show-in-tree', 'research-overview__run-stop', 'research-overview__finish']);
        await stop.click();
        await expect(g1.locator('.research-overview__run-state')).toHaveText('finishing – the agent writes up findings');
        await expect(g1.locator('.research-overview__run-stop, .research-overview__finish')).toHaveCount(0);
        await expect(g1.locator('.research-overview__show-in-tree')).toHaveCount(1);
        expect(b.writes.filter(w => w.method === 'POST').map(w => [w.path, w.body])).toEqual([['runs/stop', { run: 'run-1a07' }]]);
        // The other run goes on as it was.
        await expect(block(page, 'run-8f2c').locator('.research-overview__run-state')).toHaveText('working');
        await expect(block(page, 'run-8f2c').locator('.research-overview__run-stop')).toHaveCount(1);
    });

    test('without run.stop no Stop, Finish and stop stays', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, { runs: runsAt(), working: workingAt(), features: RUN_FEATURES.filter(f => f !== 'run.stop') });
        await openOverview(page);
        await expect(block(page, 'run-1a07').locator('.research-overview__finish')).toHaveCount(1);
        await expect(now(page).locator('.research-overview__run-stop')).toHaveCount(0);
    });

    test('a run gone: "ended at …" and the whole queue takes its direction again, no Skips; after a minute Now is as before', async ({ page }) => {
        await page.clock.install({ time: T });
        const b = await followRuns(page, { runs: runsAt(), working: workingAt(), fastReconnect: true });
        await openOverview(page);
        await expect(block(page, 'run-8f2c').locator('.research-overview__run-note')).toHaveText(['Skips: Kubíčkovi z Dolní Lhoty']);
        // Its end on the page's clock (the test's T and the moments since).
        const ended = new Date(await page.evaluate(() => Date.now())).toISOString();
        b.runs = b.runs!.filter(r => r.id !== 'run-1a07');
        b.runsEnded = [{ id: 'run-1a07', research: 'G0001', agent: 'claude', since: at(-10), ended, why: 'stopped' }];
        b.working = b.working.filter(w => w.run !== 'run-1a07');
        const g1 = block(page, 'run-1a07');
        await expect(g1.locator('.research-overview__run-state')).toHaveText(new RegExp(`^ended at ${await clockOf(page, ended)}`), { timeout: 10000 });
        await expect(g1).toHaveClass(/is-ended/);
        await expect(g1.locator('.research-overview__run-note')).toHaveText(['The whole queue takes the direction again.']);
        await expect(g1.locator('.research-overview__run-actions')).toHaveCount(0);
        await expect(block(page, 'run-8f2c')).not.toContainText('Skips');
        await expect(nowTitle(page)).toHaveText('Now · 1 agent');
        // A minute later the block goes: the general run alone is Now as before.
        await page.clock.runFor(61_000);
        await expect(g1).toHaveCount(0);
        await expect(now(page).locator('.research-overview__run')).toHaveCount(0);
        await expect(now(page).locator('.research-overview__now-row')).toHaveCount(1);
    });

    test('why a run ended: the limit and an error said quietly, before "the whole queue takes it again"; done and stopped without', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, {
            runs: [{ ...RUNS[1], since: at(-10) }], working: [{ ...RUN_WORKING[1], since: at(-2) }],
            researches: directions('G0003', { state: 'active', canStart: true, why: undefined }),
            runsEnded: [
                { id: 'run-9e10', research: null, agent: 'claude', since: at(-60), ended: at(-0.2), why: 'limit' },
                { id: 'run-2c44', research: 'G0002', agent: 'codex', since: at(-30), ended: at(-0.3), why: 'error' },
                { id: 'run-5b20', research: 'G0003', agent: 'codex', since: at(-40), ended: at(-0.25), why: 'limit' },
            ],
        });
        await openOverview(page);
        await expect(block(page, 'run-5b20').locator('.research-overview__run-note'))
            .toHaveText(['The subscription limit ran out.', 'The whole queue takes the direction again.']);
        await expect(block(page, 'run-2c44').locator('.research-overview__run-note'))
            .toHaveText(['The agent stopped with an error; the details are in the research terminal.', 'The whole queue takes the direction again.']);
        // The general run: its reason alone.
        await expect(block(page, 'run-9e10').locator('.research-overview__run-note')).toHaveText(['The subscription limit ran out.']);
        // Quiet, not a warning: the colour of any other note.
        const colours = await now(page).evaluate(n => [...n.querySelectorAll<HTMLElement>('.research-overview__run.is-ended .research-overview__run-note')]
            .map(e => getComputedStyle(e).color));
        expect(new Set(colours).size).toBe(1);
    });

    test('a run done or stopped ends without a reason; the phone in de says the limit too', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, {
            runs: [{ ...RUNS[1], since: at(-10) }], working: [{ ...RUN_WORKING[1], since: at(-2) }],
            researches: directions('G0003', { state: 'active', canStart: true, why: undefined }),
            runsEnded: [
                { id: 'run-9e10', research: null, agent: 'claude', since: at(-60), ended: at(-0.2), why: 'done' },
                { id: 'run-2c44', research: 'G0002', agent: 'codex', since: at(-30), ended: at(-0.3), why: 'limit' },
                { id: 'run-5b20', research: 'G0003', agent: 'codex', since: at(-40), ended: at(-0.25), why: 'stopped' },
            ],
            size: { width: 390, height: 844 },
        });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await expect(block(page, 'run-9e10').locator('.research-overview__run-note')).toHaveCount(0);
        await expect(block(page, 'run-5b20').locator('.research-overview__run-note'))
            .toHaveText(['Die ganze Warteschlange übernimmt die Richtung wieder.']);
        await expect(block(page, 'run-2c44').locator('.research-overview__run-note'))
            .toHaveText(['Das Abo-Limit ist aufgebraucht.', 'Die ganze Warteschlange übernimmt die Richtung wieder.']);
        const over = await now(page).evaluate(n => [...n.querySelectorAll<HTMLElement>('.research-overview__run, .research-overview__run-note')]
            .filter(e => e.scrollWidth > e.clientWidth + 1).length);
        expect(over).toBe(0);
    });

    test('a phone: every block and its state, Show in tree only', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, { runs: runsAt({ limitUntil: at(180) }), working: workingAt(), researches: threeRunDirections(), size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await expect(now(page).locator('.research-overview__run')).toHaveCount(3);
        await expect(now(page).locator('.research-overview__run-note')).toContainText(['Skips: Kubíčkovi z Dolní Lhoty, Malí z Horní Vsi']);
        await expect(now(page).locator('.research-overview__finish, .research-overview__run-stop')).toHaveCount(0);
        await expect(block(page, 'run-1a07').locator('.research-overview__show-in-tree')).toHaveCount(1);
        const over = await now(page).evaluate(n => [...n.querySelectorAll<HTMLElement>('.research-overview__run')].filter(e => e.scrollWidth > e.clientWidth + 1).length);
        expect(over).toBe(0);
    });
});

/** Only the directions' runs at work (no general run): G0001's run, and G0002's and G0003's when asked. */
function lineRunsAt(n: 1 | 3): { runs: Record<string, unknown>[]; working: Record<string, unknown>[]; researches: Record<string, unknown>[] } {
    const runs: Record<string, unknown>[] = [{ ...RUNS[1], since: at(-10) }];
    const working: Record<string, unknown>[] = [{ ...RUN_WORKING[1], since: at(-2) }];
    let researches = RUN_DIRECTIONS;
    if (n === 3) {
        for (const [id, g] of [['run-2c44', 'G0002'], ['run-3d55', 'G0003']]) {
            runs.push({ id, research: g, agent: 'codex', agentName: 'Codex', since: at(-30), state: 'working', session: `S-${g}`, task: 'T0400', sessions: 1 });
            working.push({ who: 'codex', since: at(-3), task: 'matrika', research: g, session: `S-${g}`, run: id });
        }
        researches = RUN_DIRECTIONS.map(d => d.id === 'G0001' ? d
            : { ...d, state: 'active', run: d.id === 'G0002' ? 'run-2c44' : 'run-3d55', canStart: false, why: 'running', working: true });
    }
    return { runs, working, researches };
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const settings = (page: Page) => page.locator('#research-tree-settings-modal');
const runsField = (page: Page) => page.locator('#research-runs-max');
const queueRows = (page: Page) => overview(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]');
const queueHead = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');

/** The overview with its Queue section unfolded (its heading's action is drawn only then). */
async function openQueue(page: Page): Promise<void> {
    await openOverview(page);
    if (await queueHead(page).getAttribute('aria-expanded') === 'false') await queueHead(page).click();
    await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'true');
}

test.describe('the most agents at once (spec 126 U10 §5)', () => {
    test('Research for this tree: the stepper under the agent writes a lower value; a raise gives the terminal command and the value back', async ({ page }) => {
        const b = await followRuns(page);
        await openTreeSettings(page);
        const dt = settings(page).locator('dl.research-tree-agent > dt[data-row="runs"]');
        await expect(dt).toHaveText('Agents at once, at most');
        await expect(runsField(page)).toHaveValue('3');
        await expect(runsField(page)).toHaveAttribute('max', '10');
        await expect(runsField(page)).toHaveAttribute('aria-label', 'Number of agents');
        await expect(settings(page).locator('.research-tree-runs__hint')).toHaveText('Default 3. Work on the whole queue counts too.');
        // No mark: the write goes through the bridge.
        await expect(settings(page).locator('dd[data-row="runs"] .research-open-mark, dd[data-row="runs"] .research-ai-badge')).toHaveCount(0);

        await settings(page).getByRole('button', { name: 'Fewer' }).click();
        await expect(runsField(page)).toHaveValue('2');
        await expect.poll(() => b.writes.filter(w => w.path === 'settings/runs').map(w => w.body)).toEqual([{ max: 2 }]);
        await expect(settings(page).locator('#research-runs-note')).toHaveCount(0);

        await settings(page).getByRole('button', { name: 'More' }).click();
        const note = settings(page).locator('#research-runs-note');
        await expect(note).toContainText('Raising it is possible only in the research terminal.');
        await expect(note.locator('code')).toHaveText('strom config set run.parallel 3');
        await expect(note.locator('.research-live-copy')).toHaveText('Copy');
        await expect(runsField(page)).toHaveValue('2');
        expect(b.limits!.maxRuns).toBe(2);
    });

    test('Settings › of a direction held at the limit opens the dialog at the field', async ({ page }) => {
        await followRuns(page, { researches: directions('G0002', { canStart: false, why: 'limit' }) });
        await openOverview(page);
        await unfold(page, 'G0002');
        await runBox(page, 'G0002').locator('.research-direction__run-settings').click();
        await expect(settings(page)).toBeVisible();
        await expect(runsField(page)).toBeFocused();
    });

    test('at 3 of 3: Work on the queue… held with its reason in the Queue heading, Now and the Research menu', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, lineRunsAt(3));
        await openQueue(page);
        const head = overview(page).locator('.queue-work-btn');
        await expect(head).toHaveAttribute('aria-disabled', 'true');
        await expect(head).toHaveAttribute('data-offer', 'limit');
        await expect(overview(page).locator('#queue-work-limit-queue')).toHaveText('3 agents are working; the settings allow no more. Settings ›');
        await head.click({ force: true });
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        const nowWork = now(page).locator('.research-overview__work');
        await expect(nowWork).toHaveAttribute('aria-disabled', 'true');
        await expect(now(page).locator('#queue-work-limit-now')).toContainText('3 agents are working');

        await overview(page).locator('#queue-work-limit-queue .queue-work-limit__settings').click();
        await expect(runsField(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(settings(page)).toHaveCount(0);
    });

    test('the Research menu: the item grey with why at the limit', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, lineRunsAt(3));
        await page.locator('#research-menu-btn').click();
        const item = page.locator('#research-menu #research-item-queue-work');
        await expect(item).toHaveAttribute('aria-disabled', 'true');
        await expect(item).toContainText('3 agents are working; the settings allow no more.');
    });

    test('an older research (no run.limit): no row in Research for this tree', async ({ page }) => {
        await followRuns(page, { features: RUN_FEATURES.filter(f => f !== 'run.limit') });
        await openTreeSettings(page);
        await expect(settings(page).locator('dl.research-tree-agent > dt[data-row="agent"], dl.research-tree-agent > dt').first()).toBeVisible();
        await expect(settings(page).locator('[data-row="runs"], #research-runs-max')).toHaveCount(0);
    });
});

test.describe('the whole queue beside the directions\' runs (spec 126 U10 §6)', () => {
    test('a direction with its run folded into a row above the queue, the count and numbers without it; Show › filters it with its sentence', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, lineRunsAt(1));
        await openQueue(page);
        const line = overview(page).locator('#ov-sec-queue .research-queue__line-run[data-direction="G0001"]');
        await expect(line).toHaveCount(1);
        await expect(line.locator('.research-queue__line-run-head')).toHaveText('Kubíčkovi z Dolní Lhoty · 2 tasks');
        await expect(line.locator('.research-queue__line-run-note')).toHaveText('done by the direction\'s own agent (Claude) G0001');
        // Its tasks not in the numbered list, the list numbered from 1 without them, the title counting without them.
        await expect(queueRows(page).first()).toBeVisible();
        const ids = await queueRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.task));
        expect(ids).not.toContain('T0390');
        expect(ids).not.toContain('T0393');
        const nums = await queueRows(page).locator('.live-queue-num').allTextContents();
        expect(nums.slice(0, 3)).toEqual(['1', '2', '3']);
        await expect(overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"] .live-section__title')).toHaveText('Queue · 12');

        await line.locator('.research-queue__line-run-show').click();
        const since = await clockOf(page, at(-10));
        await expect(overview(page).locator('#ov-sec-queue .research-queue__line-run-filtered'))
            .toHaveText(`This direction has its own agent at work (Claude, since ${since}). The whole queue skips it.`);
        await expect.poll(() => queueRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.task))).toEqual(['T0390', 'T0393']);
        expect(await queueRows(page).locator('.live-queue-num').allTextContents()).toEqual(['1', '2']);
        await expect(overview(page).locator('#ov-sec-queue .research-queue__line-run')).toHaveCount(0);
    });

    test('the dialog of Work on the queue… says which direction it skips and that usage adds up', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, lineRunsAt(1));
        await openQueue(page);
        await overview(page).locator('.queue-work-btn').click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.queue-work__skips')).toHaveText('Skips the direction Kubíčkovi z Dolní Lhoty (its own agent works on it).');
        await expect(dialog(page)).toContainText('1 agent is already working. Subscription usage adds up.');
        await expect(dialog(page)).not.toContainText('Oddací záznam Vojtěcha Kubíčka');
    });

    test('an older research (no run.lines): the queue as before, its tasks numbered in the whole queue', async ({ page }) => {
        await page.clock.install({ time: T });
        await followRuns(page, { ...lineRunsAt(1), features: RUN_FEATURES.filter(f => !f.startsWith('run.')) });
        await openQueue(page);
        await expect(queueRows(page).first()).toBeVisible();
        await expect(overview(page).locator('.research-queue__line-run, .research-queue__line-run-filtered, .queue-work-limit')).toHaveCount(0);
        const ids = await queueRows(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.task));
        expect(ids).toContain('T0390');
    });
});

/**
 * Fit at every width (spec 126 U10, the walkthrough): the stepper of the most
 * agents keeps its buttons beside its field, the pill of the run followed
 * cuts a long name and keeps its ×, five agents of a real research are a
 * select, and the dot of a direction's row never starts a wrapped line.
 */
test.describe('fit at every width', () => {
    /** The stepper's parts and its row: [left, right, width] each. */
    const stepper = (page: Page) => settings(page).locator('dd[data-row="runs"]').evaluate(dd => {
        const box = (e: Element | null) => { const r = e!.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
        return { row: box(dd), less: box(dd.querySelector('#research-runs-less')), field: box(dd.querySelector('#research-runs-max')), more: box(dd.querySelector('#research-runs-more')) };
    });

    test('the stepper: − and + 32 px wide beside a 44 px field, inside its row', async ({ page }) => {
        await followRuns(page);
        await openTreeSettings(page);
        const s = await stepper(page);
        expect(s.less.width).toBeGreaterThanOrEqual(32);
        expect(s.more.width).toBeGreaterThanOrEqual(32);
        expect(Math.round(s.field.width)).toBe(44);
        expect(s.more.right).toBeLessThanOrEqual(s.row.right + 0.5);
        expect(s.less.right).toBeLessThanOrEqual(s.field.left);
    });

    test.describe('touch', () => {
        test.use({ hasTouch: true, isMobile: true });
        test('390 px: − and + 44 × 44 beside the field, inside the row', async ({ page }) => {
            await followRuns(page, { size: { width: 390, height: 844 } });
            await openTreeSettings(page);
            const s = await stepper(page);
            for (const b of [s.less, s.more]) {
                expect(Math.round(b.width)).toBe(44);
                expect(Math.round(b.height)).toBe(44);
            }
            expect(Math.round(s.field.width)).toBe(52);
            expect(s.more.right).toBeLessThanOrEqual(s.row.right + 0.5);
        });
    });

    for (const width of [390, 1024]) {
        test(`the pill at ${width}: a long run's name ends with …, × inside the pill`, async ({ page }) => {
            const long = 'Kubíčkovi z Dolní Lhoty u Kutné Hory';
            await page.clock.install({ time: T });
            await page.addInitScript(() => {
                (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = { gap: 300, idle: 60_000, retry: 150 };
                if (sessionStorage.getItem('follow-seeded')) return;
                sessionStorage.setItem('follow-seeded', '1');
                localStorage.setItem('strom-live-follow', '1');
            });
            await followRuns(page, {
                runs: runsAt(), working: workingAt(), fastReconnect: true, size: { width, height: width < 641 ? 844 : 768 },
                researches: directions('G0001', { name: long }),
            });
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await page.evaluate(() => window.Strom.UI.setFollowedRun('run-1a07'));
            const pill = page.locator('#live-follow-pill');
            await expect(pill).toContainText(long);
            const fit = await pill.evaluate(p => {
                const r = p.getBoundingClientRect();
                const x = p.querySelector('.evidence-pill-close')!.getBoundingClientRect();
                return { sw: p.scrollWidth, cw: p.clientWidth, inside: x.left >= r.left - 0.5 && x.right <= r.right + 0.5 };
            });
            expect(fit.sw).toBeLessThanOrEqual(fit.cw);
            expect(fit.inside).toBe(true);
        });
    }

    for (const width of [1440, 1024]) {
        test(`five agents at ${width}: a select inside the dialog, the last one chosen goes into the link`, async ({ page }) => {
            await page.clock.install({ time: T });
            await followRuns(page, { agents: RUN_AGENTS_MANY, size: { width, height: width > 1024 ? 900 : 768 } });
            await openOverview(page);
            await unfold(page, 'G0002');
            await runBox(page, 'G0002').locator('[data-do="run"]').click();
            const d = dialog(page);
            const select = d.locator('select.queue-work__agent-select');
            await expect(select).toHaveAttribute('aria-labelledby', 'queue-work-agent-h');
            await expect(select.locator('option')).toHaveText(['Claude Code (default)', 'OpenAI Codex CLI', 'Antigravity CLI', 'OpenCode', 'Grok Build']);
            await expect(select).toHaveValue('claude');
            const out = await d.evaluate(m => {
                const r = m.getBoundingClientRect();
                return [m, ...m.querySelectorAll<HTMLElement>('*')].filter(e => {
                    const b = e.getBoundingClientRect();
                    return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5 || (e !== m && e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis'));
                }).map(e => e.className || e.tagName);
            });
            expect(out).toEqual([]);
            await select.selectOption('grok');
            await d.locator('#queue-work-open').click();
            await page.clock.runFor(1000);
            await expect.poll(() => launchedLinks(page)).toEqual([
                expect.stringMatching(/^strom-research:\/\/work\?tree=[^&]+&do=loop&research=G0002&agent=grok$/),
            ]);
        });
    }

    test('a direction\'s row: the dot ends the part before it, a wrapped line starts with no dot', async ({ page }) => {
        await followRuns(page, { size: { width: 1024, height: 768 } });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openOverview(page);
        const meta = directionRow(page, 'G0001').locator('.research-direction__meta').first();
        await expect(meta).toContainText('Agent arbeitet: Claude');
        const dots = await meta.evaluate(m => [...m.children].map(c => [getComputedStyle(c, '::before').content, getComputedStyle(c, '::after').content]));
        expect(dots.length).toBeGreaterThanOrEqual(3);
        expect(dots.map(d => d[0]).filter(c => c !== 'none' && c !== 'normal')).toEqual([]);
        expect(dots.map(d => d[1])).toEqual([...dots.slice(1).map(() => '"·"'), 'none']);
    });
});
