/**
 * "Work on the queue…" (spec 052 §5, the research's `work.link` and
 * `run.tasks`): the button in the overview's Queue heading and the Research
 * menu's item, the dialog (automatically or only n tasks 1–100, the amber
 * line without a gate, what comes first, the session's line), the link it
 * opens, "At work ›" while the research works, none on a phone, and the
 * overview's own window handing the link to the main window.
 * A fake bridge with invented data (the Fíškovi of Smrkov).
 */

import { test, expect, Locator, Page } from '@playwright/test';
import { MANAGED_AGENT, followManaged, launchedLinks, openOverview, overview } from './live-directions-bridge';

const WORK = ['work.link', 'run.tasks'];
const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0102', text: 'Kdo byl Josef Fíšek', state: 'next', research: 'G0002' },
];

const queueHead = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
const workBtn = (page: Page) => overview(page).locator('.queue-work-btn');
const dialog = (page: Page) => page.locator('#queue-work-modal [role="dialog"]');

/**
 * The box of the one element `l` matches, found and measured in one go in the
 * page. The overview draws its controls anew with every status of the
 * research (in the overview's own window several times a second): a
 * boundingBox() takes a handle first and measures it after, and a handle
 * drawn over in between is gone (null).
 */
async function boxOf(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const boxes = await l.evaluateAll(els => els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    expect(boxes).toHaveLength(1);
    return boxes[0];
}

async function unfoldQueue(page: Page): Promise<void> {
    if (await queueHead(page).getAttribute('aria-expanded') === 'false') await queueHead(page).click();
    await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'true');
}

async function follow(page: Page, opts: Parameters<typeof followManaged>[1] = {}) {
    const b = await followManaged(page, { features: WORK, links: ['work'], queue: QUEUE, ...opts });
    await openOverview(page);
    await unfoldQueue(page);
    return b;
}

test.describe('Work on the queue', () => {
    test('offered only with work.link and the work link announced', async ({ page }) => {
        await follow(page, { features: ['status.busy'] });
        await expect(workBtn(page)).toHaveCount(0);
        await expect(overview(page).locator('.queue-work-busy')).toHaveCount(0);
        // Its heading as before: no count in the title.
        await expect(queueHead(page)).not.toContainText('Queue ·');
        expect(await page.evaluate(() => window.Strom.UI.researchMenuModel().first.some(i => i.id === 'research-item-queue-work'))).toBe(false);
    });

    test('work.link without the link announced: nothing', async ({ page }) => {
        await follow(page, { links: [] });
        await expect(workBtn(page)).toHaveCount(0);
    });

    test('the button in the Queue heading, the dialog, automatically: do=loop', async ({ page }) => {
        await follow(page, { work: { gate: 'Plan 80 %', minutes: 180 } });
        const btn = workBtn(page);
        await expect(btn).toBeVisible();
        await expect(btn).toContainText('Work on the queue…');
        // The AI badge and the terminal's mark (an agent starts working there).
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(1);
        expect(Math.round((await boxOf(btn)).height)).toBe(28);
        // The count in the title while the button is there, the button on the title's row.
        await expect(queueHead(page)).toContainText('Queue · 2');
        const headBox = await boxOf(queueHead(page));
        const btnBox = await boxOf(btn);
        expect(Math.abs((btnBox.y + btnBox.height / 2) - (headBox.y + headBox.height / 2))).toBeLessThan(10);
        await btn.click();
        const d = dialog(page);
        await expect(d).toBeVisible();
        await expect(d).toHaveAttribute('aria-modal', 'true');
        await expect(page.getByRole('dialog', { name: 'Work on the queue' })).toBeVisible();
        expect(Math.round((await d.boundingBox())!.width)).toBe(460);
        const auto = d.getByRole('radio', { name: 'Automatically' });
        await expect(auto).toBeChecked();
        await expect(auto).toBeFocused();
        await expect(d.getByRole('radio', { name: 'Only 5 tasks' })).not.toBeChecked();
        await expect(d.locator('.queue-work__nogate')).toHaveCount(0);
        await expect(d.locator('.queue-work__first')).toContainText('First up');
        await expect(d.locator('.queue-work__first-task')).toHaveText('T0101 Matriky Smrkov');
        await expect(d.locator('.queue-work__session')).toHaveText('Session up to 3 h · subscription gate: Plan 80 %');
        await expect(d.locator('.queue-work__confirm')).toContainText('The research terminal confirms the start.');
        const open = d.locator('#queue-work-open');
        await expect(open).toContainText('Open terminal');
        await expect(open.locator('.research-ai-badge')).toHaveCount(1);
        await open.click();
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        expect(await launchedLinks(page)).toEqual([expect.stringMatching(/^strom-research:\/\/work\?tree=[0-9a-f-]+&do=loop$/)]);
        await expect(page.locator('.toast').filter({ hasText: 'Opening the agent' })).toHaveCount(1);
        await expect(btn).toBeFocused();
    });

    test('German: the sentence over the buttons across the foot, both buttons in one row under it', async ({ page }) => {
        await followManaged(page, { features: WORK, links: ['work'], queue: QUEUE, work: { gate: 'Plan 80 %', minutes: 180 } });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openOverview(page);
        await unfoldQueue(page);
        await workBtn(page).click();
        const d = dialog(page);
        await expect(d.locator('#queue-work-open')).toContainText('Terminal öffnen');
        const confirm = (await d.locator('.queue-work__confirm').boundingBox())!;
        const cancel = (await d.locator('#queue-work-cancel').boundingBox())!;
        const open = (await d.locator('#queue-work-open').boundingBox())!;
        const foot = (await d.locator('.queue-work__foot').boundingBox())!;
        expect(cancel.y).toBeGreaterThanOrEqual(confirm.y + confirm.height);
        expect(Math.abs((cancel.y + cancel.height / 2) - (open.y + open.height / 2))).toBeLessThan(2);
        expect(cancel.x + cancel.width).toBeLessThanOrEqual(open.x);
        // The whole width of the foot inside its padding (24 px a side).
        expect(confirm.width).toBeGreaterThan(foot.width - 48 - 2);
    });

    test('only n tasks: typing chooses it, 1–100, do=tasks&n=', async ({ page }) => {
        await follow(page);
        await workBtn(page).click();
        const d = dialog(page);
        const count = d.getByRole('spinbutton', { name: 'Number of tasks' });
        await expect(count).toHaveValue('5');
        await count.fill('1');
        await expect(d.getByRole('radio', { name: 'Only 1 task' })).toBeChecked();
        await expect(d.locator('#queue-work-only-hint')).toContainText('Stops after 1 completed task;');
        const open = d.locator('#queue-work-open');
        for (const bad of ['0', '101', '']) {
            await count.fill(bad);
            await expect(count).toHaveAttribute('aria-invalid', 'true');
            await expect(open).toBeDisabled();
        }
        // Automatically does not need the count.
        await d.getByRole('radio', { name: 'Automatically' }).check();
        await expect(open).toBeEnabled();
        await count.fill('7');
        await expect(count).not.toHaveAttribute('aria-invalid', 'true');
        await expect(d.getByRole('radio', { name: 'Only 7 tasks' })).toBeChecked();
        await expect(d.locator('#queue-work-only-hint')).toContainText('Stops after 7 completed tasks;');
        await open.click();
        expect(await launchedLinks(page)).toEqual([expect.stringMatching(/&do=tasks&n=7$/)]);
    });

    test('Escape and Cancel close it, the focus back on the button; nothing opened', async ({ page }) => {
        await follow(page);
        await workBtn(page).click();
        await expect(dialog(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        // The overview stays.
        await expect(overview(page)).toBeVisible();
        await expect(workBtn(page)).toBeFocused();
        await workBtn(page).click();
        await dialog(page).locator('#queue-work-cancel').click();
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        await expect(workBtn(page)).toBeFocused();
        expect(await launchedLinks(page)).toEqual([]);
    });

    test('without run.tasks only Automatically; without a gate the amber line, Automatically still chosen', async ({ page }) => {
        await follow(page, { features: ['work.link'], work: { gate: null, minutes: 60 } });
        await workBtn(page).click();
        const d = dialog(page);
        await expect(d.getByRole('radio')).toHaveCount(1);
        await expect(d.locator('#queue-work-count')).toHaveCount(0);
        const auto = d.getByRole('radio', { name: 'Automatically' });
        await expect(auto).toBeChecked();
        await expect(d.locator('.queue-work__nogate')).toHaveText('Automatic work needs a subscription gate; the terminal offers to set one up.');
        await expect(auto).toHaveAccessibleDescription(/subscription gate; the terminal offers/);
        await expect(d.locator('.queue-work__session')).toHaveText('Session up to 1 h');
        await d.locator('#queue-work-open').click();
        expect(await launchedLinks(page)).toEqual([expect.stringMatching(/&do=loop$/)]);
    });

    test('while the research works: "At work ›" leads to Finish and stop in Now; no menu item', async ({ page }) => {
        await follow(page, { features: [...WORK, 'status.busy'], busy: { sessions: 0, runs: 1 } });
        await expect(workBtn(page)).toHaveCount(0);
        const busy = overview(page).locator('.queue-work-busy');
        await expect(busy).toHaveText('At work ›');
        await expect(busy.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        // Now folded first: the link unfolds it.
        const nowHead = overview(page).locator('.live-section__head[aria-controls="ov-sec-now"]');
        if (await nowHead.getAttribute('aria-expanded') === 'true') await nowHead.click();
        await expect(nowHead).toHaveAttribute('aria-expanded', 'false');
        await busy.click();
        await expect(nowHead).toHaveAttribute('aria-expanded', 'true');
        await expect(overview(page).locator('#ov-sec-now .research-overview__finish')).toBeFocused();
        expect(await page.evaluate(() => window.Strom.UI.researchMenuModel().first.some(i => i.id === 'research-item-queue-work'))).toBe(false);
    });

    test('the Research menu: right under Continue with the agent, its dialog, the focus back on the menu button', async ({ page }) => {
        await follow(page);
        await page.locator('#research-menu-btn').click();
        const menu = page.locator('#research-menu');
        const item = menu.locator('#research-item-queue-work');
        await expect(item).toBeVisible();
        await expect(item).toContainText('Work on the queue…');
        const ids = await menu.locator('[id^="research-item-"]').evaluateAll(els => els.map(e => e.id));
        expect(ids.indexOf('research-item-queue-work')).toBe(ids.indexOf('research-item-chat') + 1);
        await item.click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.queue-work__first-task')).toHaveText('T0101 Matriky Smrkov');
        await dialog(page).locator('#queue-work-cancel').click();
        await expect(page.locator('#research-menu-btn')).toBeFocused();
    });

    test('a phone: neither the button nor the menu item', async ({ page }) => {
        await followManaged(page, { features: WORK, links: ['work'], queue: QUEUE, size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfoldQueue(page);
        await expect(overview(page).locator('.live-queue-row[data-task="T0101"]').first()).toBeVisible();
        await expect(workBtn(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.UI.researchMenuModel().first.some(i => i.id === 'research-item-queue-work'))).toBe(false);
    });

    test('a narrow computer window (800 px): offered, the dialog within the window', async ({ page }) => {
        await follow(page, { size: { width: 800, height: 600 } });
        await workBtn(page).click();
        const box = (await dialog(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(12);
        expect(box.x + box.width).toBeLessThanOrEqual(800 - 12);
        // 10 % of the height from the top (12–96 px).
        expect(Math.round(box.y)).toBe(60);
    });
});

const nowHead = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-now"]');
const nowWork = (page: Page) => overview(page).locator('#ov-sec-now .research-overview__work');
const nowFinish = (page: Page) => overview(page).locator('#ov-sec-now .research-overview__finish');

async function unfoldNow(page: Page): Promise<void> {
    if (await nowHead(page).getAttribute('aria-expanded') === 'false') await nowHead(page).click();
    await expect(nowHead(page)).toHaveAttribute('aria-expanded', 'true');
}

/** Nothing runs: no session in Now, the research says it is idle. */
const IDLE = { features: [...WORK, 'status.busy'], links: ['work'], queue: QUEUE, working: [], busy: { sessions: 0, runs: 0 } };
/** An agent works: its session in Now, the research says so. */
const AT_WORK = { features: [...WORK, 'status.busy'], links: ['work'], queue: QUEUE, busy: { sessions: 1, runs: 0 } };

test.describe('Work on the queue in Now', () => {
    for (const width of [1440, 1024]) {
        test(`${width} px: offered in Now while nothing runs, the same dialog and link as the Queue's`, async ({ page }) => {
            await followManaged(page, { ...IDLE, size: { width, height: 900 } });
            await openOverview(page);
            await unfoldNow(page);
            const btn = nowWork(page);
            await expect(btn).toBeVisible();
            await expect(btn).toHaveText(/Work on the queue…/);
            // The Queue's mark: the AI badge and the terminal's mark.
            await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
            await expect(btn.locator('.research-open-mark')).toHaveCount(1);
            await expect(nowFinish(page)).toHaveCount(0);
            await btn.click();
            const d = dialog(page);
            await expect(d).toBeVisible();
            await expect(d.locator('.queue-work__first-task')).toHaveText('T0101 Matriky Smrkov');
            await d.getByRole('spinbutton', { name: 'Number of tasks' }).fill('3');
            await d.locator('#queue-work-open').click();
            await expect(page.locator('#queue-work-modal')).toHaveCount(0);
            expect(await launchedLinks(page)).toEqual([expect.stringMatching(/^strom-research:\/\/work\?tree=[0-9a-f-]+&do=tasks&n=3$/)]);
            await expect(nowWork(page)).toBeFocused();
        });
    }

    test('while an agent works Now keeps Finish and stop only', async ({ page }) => {
        await followManaged(page, AT_WORK);
        await openOverview(page);
        await unfoldNow(page);
        await expect(nowFinish(page)).toBeVisible();
        await expect(nowWork(page)).toHaveCount(0);
    });

    test('a run without a session in Now (status.busy): not offered either', async ({ page }) => {
        await followManaged(page, { ...IDLE, busy: { sessions: 0, runs: 1 } });
        await openOverview(page);
        await unfoldNow(page);
        await expect(overview(page).locator('#ov-sec-now')).toBeVisible();
        await expect(nowWork(page)).toHaveCount(0);
    });

    test('without work.link: not offered', async ({ page }) => {
        await followManaged(page, { ...IDLE, features: ['status.busy'] });
        await openOverview(page);
        await unfoldNow(page);
        await expect(overview(page).locator('#ov-sec-now')).toBeVisible();
        await expect(nowWork(page)).toHaveCount(0);
    });

    test('a phone (390 px): Now offers neither, as the Queue (the terminal opens on a computer)', async ({ page }) => {
        await followManaged(page, { ...IDLE, size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await unfoldNow(page);
        await expect(overview(page).locator('#ov-sec-now')).toBeVisible();
        await expect(nowWork(page)).toHaveCount(0);
        await expect(nowFinish(page)).toHaveCount(0);
    });

    test('the overview\'s own window 390 px wide: in Now while nothing runs, the link handed to the main window; gone once an agent works', async ({ page }) => {
        // The stream reconnects soon: the research's next status comes with its next hello.
        const b = await followManaged(page, { ...IDLE, fastReconnect: true });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.setViewportSize({ width: 390, height: 844 });
        const ov = popup.locator('#research-overview.research-overview--window');
        await expect(ov).toBeVisible();
        const head = ov.locator('.live-section__head[aria-controls="ov-sec-now"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const btn = ov.locator('#ov-sec-now .research-overview__work');
        await expect(btn).toBeVisible();
        await expect(btn.locator('.research-ai-badge')).toHaveCount(1);
        await expect(btn.locator('.research-open-mark')).toHaveCount(1);
        // Within the window's width.
        const box = await boxOf(btn);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(await ov.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        await btn.click();
        const d = popup.locator('#queue-work-modal [role="dialog"]');
        await expect(d).toBeVisible();
        await d.locator('#queue-work-open').click();
        await expect.poll(() => launchedLinks(page)).toEqual([expect.stringMatching(/^strom-research:\/\/work\?tree=[0-9a-f-]+&do=loop$/)]);
        // The window's Now says the work starts (the main window's state), its button says Starting…; no toast.
        await expect(ov.locator('#ov-sec-now li.live-now-starting')).toContainText('Starting work on the queue…');
        await expect(btn).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.toast').filter({ hasText: 'Opening the agent' })).toHaveCount(0);
        // The agent starts: Now shows its session and Finish and stop, no longer the offer.
        b.working = [MANAGED_AGENT];
        b.busy = { sessions: 1, runs: 0 };
        await expect(ov.locator('#ov-sec-now .research-overview__finish')).toBeVisible({ timeout: 15000 });
        await expect(btn).toHaveCount(0);
        await popup.close();
    });
});

test.describe('Work on the queue in the overview\'s own window', () => {
    test('the dialog in the window; Open terminal handed to the main window, never the bridge', async ({ page }) => {
        await followManaged(page, { features: WORK, links: ['work'], queue: QUEUE });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        const ov = popup.locator('#research-overview.research-overview--window');
        await expect(ov).toBeVisible();
        const bridgeAsks: string[] = [];
        popup.on('request', r => { if (r.url().startsWith('http://127.0.0.1:5996')) bridgeAsks.push(r.url()); });
        const head = ov.locator('.live-section__head[aria-controls="ov-sec-queue"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        await ov.locator('.queue-work-btn').click();
        const d = popup.locator('#queue-work-modal [role="dialog"]');
        await expect(d).toBeVisible();
        await d.getByRole('spinbutton', { name: 'Number of tasks' }).fill('12');
        await d.locator('#queue-work-open').click();
        await expect(popup.locator('#queue-work-modal')).toHaveCount(0);
        await expect.poll(() => launchedLinks(page)).toEqual([expect.stringMatching(/^strom-research:\/\/work\?tree=[0-9a-f-]+&do=tasks&n=12$/)]);
        // The main window says the agent opens.
        await expect(page.locator('.toast').filter({ hasText: 'Opening the agent' })).toHaveCount(1);
        expect(bridgeAsks).toEqual([]);
        await popup.close();
    });
});

/**
 * "More (n)" under First up (the queue's tasks after the first, in the
 * research's order, not tied to "Only [n] tasks"): folded at every opening,
 * unfolded in the dialog's body (no scroll area of its own), the focus kept
 * on the button; with places and counts (`queue.page`) numbered "2.", "3." …
 * and what lies beyond named with a way to the overview's Queue.
 */
test.describe('More under First up', () => {
    const MORE_QUEUE = [
        { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' },
        { id: 'T0102', text: 'Kdo byl Josef Fíšek', state: 'next', research: 'G0002', kind: 'history' },
        { id: 'T0103', text: 'Příběh Marie Fíškové', state: 'next', research: 'G0001', own: 'next', kind: 'story' },
        { id: 'T0104', text: 'Sčítání lidu Smrkov 1880', state: 'next', research: 'G0001', own: 'next' },
        { id: 'T0105', text: 'Pozemková kniha Smrkov', state: 'next', offLine: 'never' },
        { id: 'T0106', text: 'Křest Jana Fíška', state: 'parked', research: 'G0001' },
    ];
    const moreBtn = (page: Page) => dialog(page).locator('#queue-work-more-btn');
    const moreBox = (page: Page) => dialog(page).locator('#queue-work-more');
    const rows = (page: Page) => moreBox(page).locator('.queue-work__more-row');

    test('folded: More (3); unfolded in the research\'s order without places; the count does not change it; Escape closes; folded again', async ({ page }) => {
        await follow(page, { features: [...WORK, 'queue.next', 'tasks.offLine'], queue: MORE_QUEUE });
        await workBtn(page).click();
        await expect(dialog(page).locator('.queue-work__first-task')).toHaveText('T0103 Příběh Marie Fíškové');
        const btn = moreBtn(page);
        await expect(btn).toHaveText('More (3)');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        await expect(btn).toHaveAccessibleName('More tasks in the queue: 3');
        await expect(btn.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await expect(moreBox(page)).toBeHidden();
        // Under the task, above the session's line.
        expect(await btn.evaluate(b => b.previousElementSibling?.classList.contains('queue-work__first-task'))).toBe(true);
        await btn.click();
        await expect(moreBox(page)).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await expect(btn).toHaveText('Hide more');
        await expect(btn).toBeFocused();
        // Without places: "In queue order", the hint, dashes; the other one set next first, the kind; no "never", no parked.
        await expect(moreBox(page).locator('.queue-work__more-head')).toHaveText('In queue order');
        await expect(moreBox(page).locator('.queue-work__more-hint')).toHaveText('The agent may take them in another order.');
        await expect(rows(page).locator('.queue-work__more-text')).toHaveText([
            'T0104 Sčítání lidu Smrkov 1880 next', 'T0101 Matriky Smrkov', 'T0102 Kdo byl Josef Fíšek history',
        ]);
        await expect(rows(page).locator('.queue-work__pos')).toHaveText(['–', '–', '–']);
        await expect(moreBox(page).locator('.queue-work__more-rest')).toHaveCount(0);
        // The count chooses Only n tasks, the list stays.
        await dialog(page).getByRole('spinbutton', { name: 'Number of tasks' }).fill('1');
        await expect(rows(page)).toHaveCount(3);
        // Folded again by the same button.
        await btn.click();
        await expect(moreBox(page)).toBeHidden();
        await expect(btn).toHaveText('More (3)');
        await btn.click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        await expect(workBtn(page)).toBeFocused();
        // A new opening: folded.
        await workBtn(page).click();
        await expect(moreBtn(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(moreBox(page)).toBeHidden();
    });

    test('no more tasks: no button', async ({ page }) => {
        await follow(page, { queue: [QUEUE[0]] });
        await workBtn(page).click();
        await expect(dialog(page).locator('.queue-work__first-task')).toHaveText('T0101 Matriky Smrkov');
        await expect(moreBtn(page)).toHaveCount(0);
        await expect(moreBox(page)).toHaveCount(0);
    });

    for (const width of [1440, 1024]) {
        test(`${width} px, a long queue with places: numbered, the rest named, the foot in place, Research overview › to the Queue`, async ({ page }) => {
            const queue = Array.from({ length: 57 }, (_, i) => ({
                id: `T${String(201 + i).padStart(4, '0')}`, text: `Matriky Smrkov, svazek ${i + 1}`, state: 'next', research: 'G0001',
            }));
            await follow(page, { features: [...WORK, 'queue.page'], queue, paged: true, size: { width, height: 900 } });
            await workBtn(page).click();
            const btn = moreBtn(page);
            // 57 up next, the first not counted.
            await expect(btn).toHaveText('More (56)');
            await btn.click();
            await expect(moreBox(page).locator('.queue-work__more-head')).toHaveText('Then');
            await expect(moreBox(page).locator('.queue-work__more-hint')).toHaveCount(0);
            // The status's window: the first and 13 after it.
            await expect(rows(page)).toHaveCount(13);
            await expect(rows(page).first().locator('.queue-work__pos')).toHaveText('2.');
            await expect(rows(page).last().locator('.queue-work__pos')).toHaveText('14.');
            await expect(rows(page).first().locator('.queue-work__more-text')).toHaveText('T0202 Matriky Smrkov, svazek 2, 2 in the queue');
            await expect(moreBox(page).locator('.queue-work__more-rest')).toHaveText('and 43 more tasks in the queue · Research overview ›');
            await expect(btn).toBeFocused();
            // Nothing wider than the dialog; the dialog within the window, its foot in view.
            const modal = page.locator('#queue-work-modal .modal');
            expect(await modal.evaluate(m => m.scrollWidth <= m.clientWidth)).toBe(true);
            const box = (await modal.boundingBox())!;
            expect(box.y + box.height).toBeLessThanOrEqual(900);
            await expect(dialog(page).locator('#queue-work-open')).toBeInViewport();
            const go = moreBox(page).locator('#queue-work-overview');
            await expect(go.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
            await go.click();
            await expect(page.locator('#queue-work-modal')).toHaveCount(0);
            await expect(queueHead(page)).toBeFocused();
            await expect(queueHead(page)).toHaveAttribute('aria-expanded', 'true');
        });
    }

    test('the overview\'s own window 390 px wide: the unfolded list within it', async ({ page }) => {
        const queue = Array.from({ length: 30 }, (_, i) => ({
            id: `T${String(301 + i).padStart(4, '0')}`, text: `Matriky Smrkov, oddací kniha svazek ${i + 1} (1850–1860), farnost Smrkov`, state: 'next', research: 'G0001',
        }));
        await followManaged(page, { features: [...WORK, 'queue.page'], links: ['work'], queue, paged: true });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.setViewportSize({ width: 390, height: 844 });
        const ov = popup.locator('#research-overview.research-overview--window');
        await expect(ov).toBeVisible();
        const head = ov.locator('.live-section__head[aria-controls="ov-sec-queue"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        await ov.locator('.queue-work-btn').click();
        const d = popup.locator('#queue-work-modal [role="dialog"]');
        await expect(d).toBeVisible();
        await d.locator('#queue-work-more-btn').click();
        await expect(d.locator('.queue-work__more-row')).toHaveCount(13);
        const modal = popup.locator('#queue-work-modal .modal');
        expect(Math.round((await modal.boundingBox())!.width)).toBe(366);
        expect(await modal.evaluate(m => m.scrollWidth <= m.clientWidth)).toBe(true);
        await expect(d.locator('#queue-work-open')).toBeInViewport();
        await popup.close();
    });
});

/**
 * "Open terminal" starts the work (waiting buttons 3a, 3b, 3b-d): "Opening the agent…" on it, then the dialog
 * closes and Now says "Starting work on the queue…" while both "Work on the queue…" say "Starting…" and do
 * nothing; the session's row takes the place once an agent works there. Without it within 30 s Now asks
 * whether it started, with Try again, and the buttons are free again.
 */
test.describe('Work on the queue starting', () => {
    const startRow = (page: Page) => overview(page).locator('#ov-sec-now li.live-now-starting');

    async function start(page: Page) {
        const b = await followManaged(page, { ...IDLE, fastReconnect: true });
        await openOverview(page);
        await unfoldNow(page);
        await unfoldQueue(page);
        await workBtn(page).click();
        const open = dialog(page).locator('#queue-work-open');
        await open.click();
        await expect(open).toHaveAttribute('aria-busy', 'true');
        await expect(open).toContainText('Opening the agent…');
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        return b;
    }

    test('Now says it starts, both buttons say Starting… and do nothing; the session\'s row replaces it', async ({ page }) => {
        const b = await start(page);
        expect(await launchedLinks(page)).toEqual([expect.stringMatching(/^strom-research:\/\/work\?tree=[0-9a-f-]+&do=loop$/)]);
        const row = startRow(page);
        await expect(row).toBeVisible();
        await expect(row.locator('.live-now-starting__title')).toHaveText('Starting work on the queue…');
        await expect(row.locator('.live-now-starting__title .busy-spin')).toHaveCount(1);
        await expect(row.locator('.live-now-starting__sub')).toHaveText('The agent starts in the research terminal.');
        // The state stands in Now: no toast of its own.
        await expect(page.locator('.toast').filter({ hasText: 'Opening the agent' })).toHaveCount(0);
        for (const btn of [workBtn(page), nowWork(page)]) {
            await expect(btn).toHaveAttribute('aria-busy', 'true');
            await expect(btn).toContainText('Starting…');
            await btn.click({ force: true });
        }
        await expect(page.locator('#queue-work-modal')).toHaveCount(0);
        expect(await launchedLinks(page)).toHaveLength(1);
        // Kept through a redraw of the overview.
        await page.evaluate(() => window.Strom.UI.renderLivePanel());
        await expect(startRow(page)).toBeVisible();
        // The agent starts: its session's row, Finish and stop.
        b.working = [MANAGED_AGENT];
        b.busy = { sessions: 1, runs: 0 };
        await expect(nowFinish(page)).toBeVisible({ timeout: 15000 });
        await expect(startRow(page)).toHaveCount(0);
        await expect(overview(page).locator('#ov-sec-now .research-overview__now-row')).toHaveCount(1);
    });

    test('no session within 30 s: the question with Try again and the hint, the buttons free again', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-11-18T10:00:00Z') });
        await start(page);
        await expect(startRow(page)).toBeVisible();
        await page.clock.runFor(31_000);
        const row = startRow(page);
        await expect(row).toHaveClass(/is-silent/);
        await expect(row.locator('.live-now-starting__title')).toHaveText('Did the queue work not start?');
        const msg = row.locator('.busy-msg[role="alert"]');
        await expect(msg).toContainText('The terminal did not respond within 30 s.');
        await expect(msg.locator('.hint')).toHaveText('If nothing opened, Strom Research needs to be started.');
        for (const btn of [workBtn(page), nowWork(page)]) {
            await expect(btn).not.toHaveAttribute('aria-busy', 'true');
            await expect(btn).toContainText('Work on the queue…');
        }
        await msg.getByRole('button', { name: 'Try again' }).click();
        await expect(startRow(page)).not.toHaveClass(/is-silent/);
        await expect(startRow(page).locator('.live-now-starting__title')).toHaveText('Starting work on the queue…');
        expect(await launchedLinks(page)).toHaveLength(2);
    });
});
