/**
 * "Work on the queue…" (spec 052 §5, the research's `work.link` and
 * `run.tasks`): the button in the overview's Queue heading and the Research
 * menu's item, the dialog (automatically or only n tasks 1–100, the amber
 * line without a gate, what comes first, the session's line), the link it
 * opens, "At work ›" while the research works, none on a phone, and the
 * overview's own window handing the link to the main window.
 * A fake bridge with invented data (the Fíškovi of Smrkov).
 */

import { test, expect, Page } from '@playwright/test';
import { followManaged, launchedLinks, openOverview, overview } from './live-directions-bridge';

const WORK = ['work.link', 'run.tasks'];
const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' },
    { id: 'T0102', text: 'Kdo byl Josef Fíšek', state: 'next', research: 'G0002' },
];

const queueHead = (page: Page) => overview(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
const workBtn = (page: Page) => overview(page).locator('.queue-work-btn');
const dialog = (page: Page) => page.locator('#queue-work-modal [role="dialog"]');

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
        expect(Math.round((await btn.boundingBox())!.height)).toBe(28);
        // The count in the title while the button is there, the button on the title's row.
        await expect(queueHead(page)).toContainText('Queue · 2');
        const headBox = (await queueHead(page).boundingBox())!;
        const btnBox = (await btn.boundingBox())!;
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
