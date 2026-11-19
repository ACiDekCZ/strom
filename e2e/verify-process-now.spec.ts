import { test, expect, Page } from '@playwright/test';
import { fakeBridge, links, openResearch, poll } from './research-bridge.js';
import { FakeVerify, VERIFY_FEATURES, fakeVerify, verifyGed } from './verify-bridge.js';

/**
 * "Try on N" puts its tasks at the head of the research's queue (spec 065 P7): the toast after the start
 * offers "Process now" while the research is idle (the `work` link on exactly those tasks, the AI badge and
 * the terminal mark), says the tasks are next while it works, and stays today's without `verify.tryFirst`.
 * The bulk dialog promises no background run. Invented data only.
 */

const LINE = { id: 'G0001', name: 'Zvonařík line pod Kozincem', state: 'active', focus: 'P0003' };
const TRY_FIRST = [...VERIFY_FEATURES, 'verify.tryFirst', 'work.tasks'];
const TASKS = ['T0412', 'T0413', 'T0414'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'work'];

async function setup(page: Page, opts: { features?: string[]; bulkStart?: Record<string, unknown>; links?: string[] } = {}): Promise<FakeVerify> {
    const bridge = await fakeBridge(page, {
        features: opts.features ?? TRY_FIRST, links: opts.links ?? LINKS, treeGed: verifyGed(), statusExtra: { researches: [LINE] },
    });
    const verify = await fakeVerify(page, bridge, { bulkStart: opts.bulkStart });
    await openResearch(page, { ged: verifyGed() });
    await poll(page);
    const jan = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.id);
    await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), jan);
    return verify;
}

/** The bulk dialog on its first scope (the line) with a try on 5 people, started. */
async function startTry(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
    const bulk = page.locator('#verify-bulk-modal');
    await expect(bulk.locator('input[name="vfy-try"]')).toBeChecked();
    const start = bulk.locator('[data-vfy="start"]');
    await expect(start).toContainText('Try on 5');
    await expect(start).toBeEnabled();
    await start.click();
    await expect(bulk).toHaveCount(0);
}

const toast = (page: Page) => page.locator('.toast[data-kind="verify-process"]');

async function processNow(page: Page, verify: FakeVerify): Promise<void> {
    const t = toast(page);
    await expect(t).toContainText('4 facts to verify are at the head of the queue. The research is not working now.');
    const act = t.locator('.toast-action');
    await expect(act).toContainText('Process now');
    // The agent works in the research's terminal at once: the AI badge and the terminal mark.
    await expect(act.locator('.research-ai-badge')).toHaveCount(1);
    await expect(act.locator('.research-open-mark')).toHaveCount(1);
    await expect(t.locator('.toast-close')).toHaveCount(1);
    expect(verify.posts.at(-1)).toEqual({ route: 'verify/bulk', body: { scope: 'line', of: 'G0001', order: 'ancestors', try: 5 } });
    await act.click();
    await expect.poll(() => links(page)).toContainEqual(
        expect.stringMatching(new RegExp(`^strom-research://work\\?tree=[0-9a-f-]+&do=tasks&task=${TASKS.join(',')}$`)));
}

test.describe('verify: Try on N at the head of the queue, Process now (spec 065 P7)', () => {
    test('desktop: the dialog says where the progress is and that the try goes first; idle research: Process now opens work on its tasks', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const verify = await setup(page, { bulkStart: { tasks: TASKS, first: true, working: false } });
        await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk.locator('.vfy-try .vfy-opt-sub')).toHaveText("Its tasks go to the head of the research's queue. After 5 people it stops and shows the result.");
        await expect(bulk.locator('.vfy-est-note')).toHaveText('Verified when the research works; progress and Stop in “What the research knows › Verifying”.');
        await expect(bulk).not.toContainText('background');
        await bulk.locator('[data-vfy="close"]').first().click();
        await startTry(page);
        await processNow(page, verify);
    });

    test('the research at work: its tasks are next, nothing to start', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page, { bulkStart: { tasks: TASKS, first: true, working: true } });
        await startTry(page);
        await expect(page.locator('.toast', { hasText: "4 facts to verify are next in the research's queue." })).toBeVisible();
        await expect(page.locator('.toast-action', { hasText: 'Process now' })).toHaveCount(0);
        expect((await links(page)).filter(l => l.startsWith('strom-research://work'))).toEqual([]);
    });

    test('idle, but the research takes no link on tasks: at the head of the queue, no action', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page, { features: [...VERIFY_FEATURES, 'verify.tryFirst'], bulkStart: { tasks: TASKS, first: true, working: false } });
        await startTry(page);
        await expect(page.locator('.toast', { hasText: '4 facts to verify are at the head of the queue; verified when the research works next.' })).toBeVisible();
        await expect(page.locator('.toast-action', { hasText: 'Process now' })).toHaveCount(0);
    });

    test('without verify.tryFirst: today\'s toast and no promise of the head of the queue', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page, { features: VERIFY_FEATURES, bulkStart: { tasks: TASKS, first: true, working: false } });
        await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk.locator('.vfy-try .vfy-opt-sub')).toHaveText('After 5 people it stops and shows the result.');
        await expect(bulk.locator('.vfy-est-note')).toContainText('Verified when the research works');
        await bulk.locator('[data-vfy="close"]').first().click();
        await startTry(page);
        await expect(page.locator('.toast', { hasText: '4 facts queued for verification.' })).toBeVisible();
        await expect(page.locator('.toast-action', { hasText: 'Process now' })).toHaveCount(0);
    });

    test('phone 390: the dialog scrolls, the try\'s longer text keeps clear of the estimate; the toast with Process now fits, the action takes a tap', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const verify = await setup(page, { bulkStart: { tasks: TASKS, first: true, working: false } });
        await page.evaluate(() => window.Strom.UI.showVerifyBulkDialog());
        const bulk = page.locator('#verify-bulk-modal');
        await expect(bulk.locator('.vfy-est-head')).toContainText('4 facts');
        // A short screen: the body scrolls; its parts are not squeezed so that one runs under the next.
        await page.setViewportSize({ width: 390, height: 600 });
        const [tryBottom, estTop] = await bulk.evaluate(m => [
            m.querySelector('.vfy-try .vfy-opt-sub')!.getBoundingClientRect().bottom,
            m.querySelector('.vfy-est')!.getBoundingClientRect().top,
        ]);
        expect(tryBottom).toBeLessThanOrEqual(estTop);
        await page.setViewportSize({ width: 390, height: 844 });
        await bulk.locator('[data-vfy="close"]').first().click();
        await startTry(page);
        const t = toast(page);
        await expect(t).toBeVisible();
        const box = (await t.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(await t.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await processNow(page, verify);
    });
});
