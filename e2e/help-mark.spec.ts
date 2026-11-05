import { test, expect, Page, Locator } from '@playwright/test';
import { openResearch, researchGed } from './research-bridge.js';
import { setupConflict, openKnows, openEdit, tag, panel } from './research-conflict.js';

/**
 * The help mark "?" (1105 §9–§10): the last item on the right of the heading
 * row of Queue, Awaiting action and Now (the small panel and the Research
 * overview), of the Places window, the places manager, the conflicts panel
 * and the Conflicts section of What the research knows. A click opens How
 * Strom works over the window right at the place's rule (Now while a run is
 * paused: R7.6), never folds the section; Escape closes only the help and
 * the keyboard comes back to the "?". Invented data only.
 */

const UUID = '6b1d2e40-9c3a-4f71-8e25-1a7c0d9b3f52';
const BRIDGE = 'http://127.0.0.1:5994/abcdef0123456789abcdef0123456789';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup'];

function liveGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Velbrandovi',
        '0 @P0001@ INDI', '1 NAME Orlin /Velbrand/', '1 SEX M', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Senka /Moravcová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Taveš /Velbrand/', '1 SEX M', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 TRLR',
    ].join('\n');
}

/** Following a research live: one agent at work (paused or not), two tasks waiting, a queue. */
async function follow(page: Page, paused = false, size = { width: 1440, height: 900 }): Promise<void> {
    await page.setViewportSize(size);
    const at = new Date().toISOString();
    const status = () => ({
        tree: { id: UUID, name: 'Velbrandovi' }, head: 'h1', persons: 3,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 16 * 60_000).toISOString(),
            ...(paused ? { paused: { until: new Date(Date.now() + 3 * 3600_000).toISOString(), reason: 'usage 92 %' } } : { task: 'Sčítání 1921', person: 'P0003' }) }],
        waiting: [{ id: 'T0004', what: 'Uložit snímek oddací matriky', person: 'P0003', at }, { id: 'T0005', what: 'Potvrdit otce', at }],
        links: LINKS,
        queue: [{ id: 'T0101', text: 'Matriky Bredov', state: 'next', person: 'P0001' }, { id: 'T0102', text: 'Pozemková kniha', state: 'next' }],
        queueMore: 0,
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (path.endsWith('/status')) return json(status());
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: liveGed() });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
}

/** The heading row of a section whose title says `title`. */
const rowOf = (root: Locator, title: string | RegExp): Locator => root.locator('.live-section__headrow')
    .filter({ has: root.page().locator('.live-section__title', { hasText: title }) });

/** "?" is the last item of its row, on its right edge, and on the heading's line. */
async function lastOnTheRight(row: Locator, mark: Locator): Promise<void> {
    await expect(mark).toBeVisible();
    const last = await row.evaluate(r => {
        const kids = [...r.querySelectorAll<HTMLElement>(':scope > *, :scope > .live-section__tail > *')].filter(k => !k.classList.contains('live-section__tail'));
        return kids.at(-1)?.classList.contains('help-mark') ?? false;
    });
    expect(last).toBe(true);
    const r = (await row.boundingBox())!;
    const m = (await mark.boundingBox())!;
    expect(Math.abs((r.x + r.width) - (m.x + m.width))).toBeLessThanOrEqual(1);
    expect(m.width).toBe(18);
    expect(m.height).toBe(18);
}

/** A click opens the help over everything at `target`; Escape closes only the help, the keyboard back on "?". */
async function opensAt(page: Page, mark: Locator, target: string, under: Locator): Promise<void> {
    await expect(mark).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(mark).toHaveAttribute('aria-expanded', 'false');
    await mark.click();
    await expect(page.locator('.help-modal')).toBeVisible();
    if (target.includes('.')) await expect(page.locator(`.help-rule[data-rule="${target}"]`)).toHaveClass(/is-target/);
    await expect(page.locator('.help-h1')).toContainText(target.split('.')[0]);
    await expect(mark).toHaveAttribute('aria-expanded', 'true');
    const z = await page.locator('.help-overlay').evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThanOrEqual(2000);
    await page.keyboard.press('Escape');
    await expect(page.locator('.help-overlay')).toHaveCount(0);
    await expect(under).toBeVisible();
    await expect(mark).toBeFocused();
    await expect(mark).toHaveAttribute('aria-expanded', 'false');
}

test.describe('the help mark on a computer', () => {
    test('small panel: Now, Awaiting action and Up next end with "?"; a click opens the rule and folds nothing @smoke', async ({ page }) => {
        await follow(page);
        const live = page.locator('#live-panel');
        await expect(live.locator('.live-section__head').first()).toBeVisible();
        const now = rowOf(live, 'At work');
        const nowMark = now.locator('.help-mark');
        await lastOnTheRight(now, nowMark);
        await expect(nowMark).toHaveAttribute('aria-label', 'How it works: Agent at work');
        await expect(nowMark).toHaveAttribute('title', 'How it works: Agent at work (R7)');
        await expect(nowMark).toHaveText('?');
        // Never inside the folding heading's button.
        await expect(live.locator('.live-section__head .help-mark')).toHaveCount(0);
        const head = now.locator('.live-section__head');
        const expanded = await head.getAttribute('aria-expanded');
        await opensAt(page, nowMark, 'R7', live);
        await expect(head).toHaveAttribute('aria-expanded', expanded!);

        const waiting = rowOf(live, /Awaiting action/);
        await lastOnTheRight(waiting, waiting.locator('.help-mark'));
        await expect(waiting.locator('.help-mark')).toHaveAttribute('title', 'How it works: Awaiting action (R6.4)');
        await opensAt(page, waiting.locator('.help-mark'), 'R6.4', live);

        const queue = rowOf(live, 'Up next');
        if (await queue.count() > 0) {
            await expect(queue.locator('.help-mark')).toHaveAttribute('title', 'How it works: Queue (R2.4)');
        }
    });

    test('Research overview: Now, Awaiting action and Queue end with "?"; the help opens over the overview, Esc leaves the overview open', async ({ page }) => {
        await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const now = rowOf(ov, 'Now');
        await lastOnTheRight(now, now.locator('.help-mark'));
        const waiting = rowOf(ov, /Awaiting action/);
        await lastOnTheRight(waiting, waiting.locator('.help-mark'));
        const queue = rowOf(ov, 'Queue');
        await lastOnTheRight(queue, queue.locator('.help-mark'));
        await expect(ov.locator('.live-section__head .help-mark')).toHaveCount(0);
        const head = queue.locator('.live-section__head');
        const expanded = await head.getAttribute('aria-expanded');
        await opensAt(page, queue.locator('.help-mark'), 'R2.4', ov);
        await expect(head).toHaveAttribute('aria-expanded', expanded!);
        await expect(ov).toBeVisible();
        await opensAt(page, waiting.locator('.help-mark'), 'R6.4', ov);
        await opensAt(page, now.locator('.help-mark'), 'R7', ov);
    });

    test('a paused run: Now\'s "?" says Pause and opens R7.6', async ({ page }) => {
        await follow(page, true);
        const live = page.locator('#live-panel');
        const mark = rowOf(live, 'At work').locator('.help-mark');
        await expect(mark).toHaveAttribute('aria-label', 'How it works: Pause');
        await expect(mark).toHaveAttribute('title', 'How it works: Pause (R7.6)');
        await opensAt(page, mark, 'R7.6', live);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        const ovMark = rowOf(ov, 'Now').locator('.help-mark');
        await expect(ovMark).toHaveAttribute('title', 'How it works: Pause (R7.6)');
        await opensAt(page, ovMark, 'R7.6', ov);
    });

    test('the Places window and the places manager: "?" right before ×', async ({ page }) => {
        await openResearch(page, { bridge: false, ged: researchGed(undefined, [
            '0 @P0009@ INDI', '1 NAME Darin /Velbrand/', '1 SEX M', '1 BIRT', '2 DATE 1861', '2 PLAC Bredov', '1 REFN P0009',
        ]) });
        await page.evaluate(() => window.Strom.UI.showWaitingPlaces());
        const places = page.locator('#waiting-places-modal');
        await expect(places).toBeVisible();
        const header = places.locator('.modal-header');
        const mark = header.locator('.help-mark');
        await expect(mark).toHaveAttribute('title', 'How it works: Places (R4.5)');
        const order = await header.evaluate(h => [...h.children].map(c => c.className));
        expect(order.slice(-2)).toEqual(['help-mark', 'close-btn']);
        const m = (await mark.boundingBox())!;
        const x = (await header.locator('.close-btn').boundingBox())!;
        expect(Math.round(x.x - (m.x + m.width))).toBe(8);
        await opensAt(page, mark, 'R4.5', places);
        await page.keyboard.press('Escape');
        await expect(places).toBeHidden();

        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const manager = page.locator('#places-modal');
        await expect(manager).toBeVisible();
        const mMark = manager.locator('.modal-header .help-mark');
        await expect(mMark).toHaveAttribute('title', 'How it works: Places in the tree (R4.4)');
        const mOrder = await manager.locator('.modal-header').evaluate(h => [...h.children].map(c => c.className));
        expect(mOrder.slice(-2)).toEqual(['help-mark', 'close-btn']);
        await opensAt(page, mMark, 'R4.4', manager);
    });

    test('conflicts: the Conflicts section of What the research knows (R5.6) and the conflicts panel (R5.3)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupConflict(page);
        await openKnows(page);
        const knows = page.locator('#person-research-modal');
        const sectionHead = knows.locator('.person-research-section-head');
        const mark = sectionHead.locator('.help-mark');
        await expect(mark).toHaveAttribute('title', 'How it works: Conflicts (R5.6)');
        await lastOnTheRight(sectionHead, mark);
        // Not in the dialog's own header.
        await expect(knows.locator('.modal-header .help-mark')).toHaveCount(0);
        await opensAt(page, mark, 'R5.6', knows);
        await page.keyboard.press('Escape');
        await expect(knows).toBeHidden();

        await openEdit(page);
        await tag(page).click();
        await expect(panel(page)).toBeVisible();
        const pMark = panel(page).locator('.prc-panel-head .help-mark');
        await expect(pMark).toHaveAttribute('title', 'How it works: Conflicts (R5.3)');
        const order = await panel(page).locator('.prc-panel-head').evaluate(h => [...h.children].map(c => c.className));
        expect(order.slice(-2)).toEqual(['help-mark', 'prc-panel-close']);
        await opensAt(page, pMark, 'R5.3', panel(page));
        // Escape now closes the panel itself.
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
    });
});

test.describe('the help mark on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('phone 390×844: the target is 44 px, the mark stays 18 px and on the heading\'s line', async ({ page }) => {
        await follow(page, false, { width: 390, height: 844 });
        await expect(page.locator('#live-panel')).toHaveClass(/phone-strip/);
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        const queue = rowOf(ov, 'Queue');
        const mark = queue.locator('.help-mark');
        await expect(mark).toBeVisible();
        const target = await mark.evaluate(b => {
            const s = getComputedStyle(b, '::before');
            return { top: s.top, bottom: s.bottom, left: s.left, right: s.right };
        });
        // 44 × 44, grown to the left only: nothing sticks out of the row's right edge.
        expect(target).toEqual({ top: '-13px', bottom: '-13px', left: '-26px', right: '0px' });
        expect(await queue.evaluate(r => r.scrollWidth <= r.clientWidth)).toBe(true);
        const m = (await mark.boundingBox())!;
        const h = (await queue.locator('.live-section__head').boundingBox())!;
        expect(m.y).toBeLessThan(h.y + h.height);
        expect(m.y + m.height).toBeGreaterThan(h.y);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(wide).toBe(false);
        await mark.tap();
        await expect(page.locator('.help-rule[data-rule="R2.4"]')).toBeVisible();
    });
});
