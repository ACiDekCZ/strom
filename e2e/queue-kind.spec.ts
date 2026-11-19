/**
 * The queue by its kind of work (spec 065 K7.4, the research's `queue.kind`):
 * the chips "Verification 12", "Registers 45", "Stories 3" under the lines'
 * chips of the overview's Queue, counted by `/status.queueCounts.kind`; a chip
 * picked sends `kind=` to `GET /queue` with the line and the searched text,
 * picked again clears it. "Show in the queue" beside "Waiting to be verified"
 * opens the Queue narrowed to Verification (stays in the app: no mark).
 * Without the feature none of it is there and no `kind` is sent. Desktop and a
 * phone of 390. A fake bridge with invented data.
 */

import { test, expect, Page } from '@playwright/test';
import { ManagedBridge, followManaged, openOverview, overview } from './live-directions-bridge';

const BASE = ['directions.edit', 'directions.order', 'queue.page', 'queue.search', 'verify', 'verify.bulk', 'verify.stop'];
const KIND = [...BASE, 'queue.kind'];

/**
 * 60 tasks up next (T0501–T0560): three stories of the Fíšeks first, every fifth one a verification at the
 * parish of Zálesná (G0002 every tenth, else G0001), the rest registers of Smrkov; one verification set aside.
 */
function queue(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (let i = 1; i <= 60; i++) {
        const id = `T${String(500 + i).padStart(4, '0')}`;
        if (i <= 3) out.push({ id, text: `Vyprávění o Fíškových ${i}`, state: 'next', research: 'G0001', taskKind: 'story' });
        else if (i % 5 === 0) {
            out.push({ id, text: `Ověřit křest Hrabaňáka, fara Zálesná ${i}`, state: 'next', research: i % 10 === 0 ? 'G0002' : 'G0001', taskKind: 'verify' });
        } else out.push({ id, text: `Matriky Smrkov ${i}`, state: 'next', research: 'G0001', taskKind: 'records' });
    }
    out.push({ id: 'T0600', text: 'Ověřit sňatek Hrabaňáka, fara Zálesná', state: 'parked', research: 'G0001', taskKind: 'verify' });
    return out;
}

const follow = (page: Page, features: string[], size?: { width: number; height: number }): Promise<ManagedBridge> =>
    followManaged(page, { features, queue: queue(), paged: true, verify: { waiting: 3 }, ...(size ? { size } : {}) });

const head = (page: Page, key: string) => overview(page).locator(`.live-section__head[aria-controls="ov-sec-${key}"]`);
const kinds = (page: Page) => overview(page).locator('.research-overview__queue-kinds');
const kindChip = (page: Page, kind: string) => kinds(page).locator(`[data-task-kind="${kind}"]`);
const nextRows = (page: Page) => overview(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]:not(.live-queue-row--parked)');
const queueLink = (page: Page) => overview(page).locator('[data-verify-section="tree"] [data-verify-act="queue"]');
const field = (page: Page) => overview(page).locator('.research-overview__queue-search-input');
const kindReads = (b: ManagedBridge) => b.queueReads.filter(q => q.includes('kind='));

async function unfold(page: Page, key: string): Promise<void> {
    await expect(head(page, key)).toBeVisible();
    if (await head(page, key).getAttribute('aria-expanded') === 'false') await head(page, key).click();
    await expect(head(page, key)).toHaveAttribute('aria-expanded', 'true');
}

/** Nothing of the page or the overview scrolls sideways. */
async function noSideways(page: Page): Promise<void> {
    expect(await overview(page).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe('the queue by kind of work (queue.kind)', () => {
    test('without queue.kind: no kinds\' chips, no "Show in the queue", no kind sent', async ({ page }) => {
        const b = await follow(page, BASE);
        await openOverview(page);
        await unfold(page, 'queue');
        await expect(overview(page).locator('.research-overview__queue-filters [data-direction]').first()).toBeVisible();
        await expect(kinds(page)).toHaveCount(0);
        await unfold(page, 'knows');
        await expect(overview(page).locator('[data-verify-section="tree"] .vfy-sec-pending')).toContainText('Waiting to be verified: 3 facts');
        await expect(queueLink(page)).toHaveCount(0);
        expect(kindReads(b)).toEqual([]);
    });

    test('the chips with counts in their order; a chip sends kind=, with the line and the search; picked again it clears', async ({ page }) => {
        const b = await follow(page, KIND);
        await openOverview(page);
        await unfold(page, 'queue');
        await expect(kinds(page)).toHaveAttribute('aria-label', 'Task type');
        // Only kinds with a task, in their fixed order (not the counts' order).
        await expect(kinds(page).locator('.research-overview__filter')).toHaveText(['Verification 12', 'Registers 45', 'Stories 3']);
        await expect(kinds(page).locator('[aria-pressed="true"]')).toHaveCount(0);
        // The same chips as the lines' ones, right under them.
        expect(await kindChip(page, 'verify').evaluate(e => e.className)).toBe('research-overview__filter sel-opt');
        const order = await overview(page).locator('#ov-sec-queue').evaluate(n => [...n.children].map(c => c.className));
        const lines = order.findIndex(c => c.includes('research-overview__queue-filters') && !c.includes('queue-kinds'));
        expect(order[lines + 1]).toContain('research-overview__queue-kinds');

        await kindChip(page, 'verify').click();
        await expect.poll(() => kindReads(b)).toEqual(['count=50&kind=verify']);
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'true');
        await expect(kindChip(page, 'verify')).toHaveText('Verification 12 ×');
        await expect(kindChip(page, 'verify')).toBeFocused();
        await expect(nextRows(page)).toHaveCount(12);
        // Each task keeps its place in the whole queue.
        await expect(nextRows(page).first().locator('.live-queue-num')).toHaveText('5');
        await expect(nextRows(page).first()).toContainText('Ověřit křest Hrabaňáka, fara Zálesná 5');

        // With a line: both sent.
        await overview(page).locator('.research-overview__queue-filters [data-direction="G0002"]').click();
        await expect.poll(() => kindReads(b)).toContain('count=50&research=G0002&kind=verify');
        await expect(nextRows(page)).toHaveCount(6);
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'true');

        // And with a search.
        await field(page).fill('zalesna');
        await expect(overview(page).locator('.research-overview__queue-result')).toHaveText('6 tasks found · in Potomci: Josef Fíšek · type Verification');
        expect(kindReads(b)).toContain('count=50&research=G0002&kind=verify&q=zalesna');

        // Picked again: every kind again, the line and the text stay.
        await kindChip(page, 'verify').click();
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'false');
        await expect(kindChip(page, 'verify')).toHaveText('Verification 12');
        await expect.poll(() => b.queueReads.at(-1)).toBe('count=50&research=G0002&q=zalesna');

        // A kind the search finds nothing in: said with the way back to every kind.
        await field(page).fill('Smrkov');
        await expect(overview(page).locator('.research-overview__queue-result')).toContainText('Nothing found in Potomci: Josef Fíšek.');
        await overview(page).locator('.research-overview__queue-filters [data-direction="all"]').click();
        await kindChip(page, 'story').click();
        await expect(overview(page).locator('.research-overview__queue-result')).toContainText('Nothing found among tasks of type Stories.');
        await overview(page).locator('.research-overview__queue-result [data-do="all-kinds"]').click();
        await expect(kindChip(page, 'story')).toHaveAttribute('aria-pressed', 'false');
        await expect(overview(page).locator('.research-overview__queue-result')).toHaveText('45 tasks found');
    });

    test('"Show in the queue" beside Waiting to be verified: the Queue narrowed to Verification, every line, no mark; from the tree\'s dialog too', async ({ page }) => {
        const b = await follow(page, KIND);
        await openOverview(page);
        await unfold(page, 'queue');
        await overview(page).locator('.research-overview__queue-filters [data-direction="G0002"]').click();
        await head(page, 'queue').click();
        await expect(head(page, 'queue')).toHaveAttribute('aria-expanded', 'false');
        await unfold(page, 'knows');
        const link = queueLink(page);
        await expect(link).toHaveText('Show in the queue');
        // It stays in the app: no AI badge, no terminal mark.
        await expect(link.locator('.research-ai-badge, .research-open-mark, svg')).toHaveCount(0);
        await link.click();
        await expect(head(page, 'queue')).toHaveAttribute('aria-expanded', 'true');
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'true');
        await expect(kindChip(page, 'verify')).toBeFocused();
        await expect(overview(page).locator('.research-overview__queue-filters [data-direction="all"]')).toHaveAttribute('aria-checked', 'true');
        await expect.poll(() => kindReads(b)).toContain('count=50&kind=verify');
        await expect(nextRows(page)).toHaveCount(12);

        // From the tree's own "What the research knows": the dialog closes, the overview's Queue the same.
        await kindChip(page, 'verify').click();
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'false');
        await page.evaluate(() => window.Strom.UI.showVerifyTreeDialog());
        const tree = page.locator('#verify-tree-modal');
        await tree.locator('[data-verify-act="queue"]').click();
        await expect(tree).toHaveCount(0);
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a phone of 390: the chips wrap, nothing sideways; a chip and the link work', async ({ page }) => {
        const b = await follow(page, KIND, { width: 390, height: 844 });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfold(page, 'queue');
        await expect(kinds(page).locator('.research-overview__filter')).toHaveText(['Verification 12', 'Registers 45', 'Stories 3']);
        expect(await kinds(page).evaluate(e => getComputedStyle(e).flexWrap)).toBe('wrap');
        await noSideways(page);
        await kindChip(page, 'records').click();
        await expect.poll(() => kindReads(b)).toEqual(['count=50&kind=records']);
        await expect(kindChip(page, 'records')).toHaveAttribute('aria-pressed', 'true');
        await noSideways(page);
        await unfold(page, 'knows');
        await queueLink(page).scrollIntoViewIfNeeded();
        await queueLink(page).click();
        await expect(kindChip(page, 'verify')).toHaveAttribute('aria-pressed', 'true');
        await expect(kindChip(page, 'records')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => kindReads(b)).toContain('count=50&kind=verify');
        await noSideways(page);
    });
});
