import { test, expect, Page } from '@playwright/test';
import { FakeBridge, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * Holds of tasks and archives (spec 127 K3.1) in the Research overview: with
 * `task.holds` / `archive.holds` the Now row of an agent working directly
 * says its last sign and when its hold ends, a run waiting for an archive
 * says which and until when, and a queued task says who holds it or who uses
 * its archive. An older research (no features): the rows as before. Invented
 * data; a fixed clock; the times in the browser's own clock.
 */

const NOW = new Date('2026-11-21T13:33:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];
const SITE = 'www.lhota-archiv.example';
const HOLD = { by: 'agent', since: '2026-11-21T13:05:00Z', beat: '2026-11-21T13:31:00Z', until: '2026-11-21T14:01:00Z' };
const WORKING = [
    { who: 'Claude Code working directly', since: '2026-11-21T13:05:00Z', session: 'N0040', task: 'Křest Jana Lhotáka', hold: HOLD },
    {
        who: 'Claude Code working alone', since: '2026-11-21T12:58:00Z',
        paused: { until: '2026-11-21T13:40:00Z', reason: `waiting for the archive ${SITE}`, archive: SITE, since: '2026-11-21T13:10:00Z' },
        waits: { archive: SITE, since: '2026-11-21T13:10:00Z', until: '2026-11-21T13:40:00Z' },
    },
];
const QUEUE = [
    { id: 'T0101', text: 'Oddací matrika Lhota', state: 'next', heldBy: { session: 'N0041', who: 'Codex', ...HOLD } },
    { id: 'T0102', text: 'Křestní matrika Lhota', state: 'next', archiveHeld: { site: SITE, until: '2026-11-21T14:01:00Z', own: false, by: 'agent', since: HOLD.since, beat: HOLD.beat } },
    { id: 'T0103', text: 'Sčítání 1869', state: 'next' },
];

async function researchTree(page: Page, features: string[]): Promise<FakeBridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page, { ged: researchGed() });
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, treeGed: researchGed(), features,
        statusExtra: { working: WORKING, queue: QUEUE },
    });
    await poll(page);
    return bridge;
}

const ov = (page: Page) => page.locator('#research-overview');

async function openOverview(page: Page): Promise<void> {
    await page.locator('#research-menu-btn').click();
    await page.locator('#research-item-overview').click();
    await expect(ov(page)).toBeVisible();
    // The queue folded open.
    await ov(page).locator('.live-queue-toggle').click();
    await expect(ov(page).locator('.live-queue-row[data-task]').first()).toBeVisible();
}

/** An ISO time in the browser's clock, as the app writes it. */
const clock = (page: Page, iso: string) => page.evaluate(t => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(t)), iso);

test.describe('holds of tasks and archives', () => {
    test('with the features: the agent\'s hold, the run waiting for an archive, who holds a queued task or its archive', async ({ page }) => {
        await researchTree(page, ['task.holds', 'archive.holds']);
        await openOverview(page);
        const [since, last, free, gives] = await Promise.all([HOLD.since, HOLD.beat, HOLD.until, '2026-11-21T13:40:00Z'].map(t => clock(page, t)));
        await expect(ov(page).locator('.live-hold')).toHaveText(`last sign ${last}; free by ${free} at the latest`);
        await expect(ov(page).locator('.live-paused').first()).toHaveText(`Paused · waiting for the archive ${SITE} (at most until ${gives})`);
        const rows = ov(page).locator('.live-queue-row[data-task]');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.live-queue-held')).toBeVisible();
        await expect(rows.nth(0).locator('.live-queue-held')).toHaveText(
            `The task is held by Codex (session N0041) since ${since}, last sign ${last}; free by ${free} at the latest.`);
        await expect(rows.nth(0).locator('.live-queue-held')).toHaveAttribute('data-held', 'task');
        await expect(rows.nth(1).locator('.live-queue-held')).toHaveText(
            `The archive ${SITE} is used by another research now (since ${since}, last sign ${last}); free by ${free} at the latest.`);
        await expect(rows.nth(1).locator('.live-queue-held')).toHaveAttribute('data-held', 'archive');
        await expect(rows.nth(2).locator('.live-queue-held')).toHaveCount(0);
        // Nothing runs out of its row (a long archive's name wraps).
        const over = await ov(page).locator('.live-queue-held').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).length);
        expect(over).toBe(0);
    });

    test('an older research (no features): the rows as before', async ({ page }) => {
        await researchTree(page, ['working.place']);
        await openOverview(page);
        await expect(ov(page).locator('.live-queue-row[data-task]')).toHaveCount(3);
        await expect(ov(page).locator('.live-queue-held')).toHaveCount(0);
        await expect(ov(page).locator('.live-hold')).toHaveCount(0);
        const resumes = await clock(page, '2026-11-21T13:40:00Z');
        await expect(ov(page).locator('.live-paused').first()).toHaveText(`Paused · waiting for the archive ${SITE} · resumes at ${resumes}`);
    });
});
