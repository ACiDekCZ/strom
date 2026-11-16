import { test, expect, Page } from '@playwright/test';

/**
 * The small research panel beside the overview's own window (spec 079 U9):
 * while the Research overview is in a window of its own, the main window's
 * panel on a computer keeps its head and "Working" only (expanded, whatever
 * Customize panel says; nobody at work: "Nothing is being worked on now");
 * Awaiting action, Latest changes and Up next are in that window. Closed,
 * the panel is whole again. ⤢ brings the window forward, no other window
 * opens. At a tablet's width the panel stays whole. Invented data only.
 */

const UUID = '3b8d1f60-7a2c-4e95-b1d4-6c0e9f2a7d18';
const BRIDGE = 'http://127.0.0.1:5996/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];
const DESKTOP = { width: 1440, height: 900 };
/** The page's fixed "now" (away from midnight UTC); the fixture's times are taken from it, never from the system clock. */
const NOW = new Date('2026-11-16T10:54:00.000Z');
const TABLET = { width: 900, height: 900 };

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Vlasákovi z Horní Lhoty',
    '0 @P0001@ INDI', '1 NAME Vavřinec /Vlasák/', '1 SEX M', '1 BIRT', '2 DATE 1868', '1 REFN P0001',
    '0 @P0002@ INDI', '1 NAME Apolena /Šindelářová/', '1 SEX F', '1 BIRT', '2 DATE 1872', '1 REFN P0002',
    '0 TRLR',
].join('\n');

/** The main window follows a research (an agent at work or not) with something waiting and a queue. */
async function follow(page: Page, o: { working: boolean; prefs?: Record<string, string>; viewport?: { width: number; height: number } }): Promise<void> {
    await page.setViewportSize(o.viewport ?? DESKTOP);
    // The context's clock: the overview's own window (a popup of this context) has the same "now".
    await page.clock.setFixedTime(NOW);
    await page.context().addInitScript(({ links, prefs }) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        if (prefs && !sessionStorage.getItem('prefs-set')) {
            sessionStorage.setItem('prefs-set', '1');
            localStorage.setItem('strom-live-section-prefs', JSON.stringify({ v: 2, s: prefs }));
        }
    }, { links: LINKS, prefs: o.prefs ?? null });
    const at = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const status = () => ({
        tree: { id: UUID, name: 'Vlasákovi z Horní Lhoty' }, head: 'h1', persons: 2, links: LINKS,
        queue: [{ id: 'T0201', text: 'Matriky Horní Lhota 1860–1880', state: 'next', person: 'P0001' }, { id: 'T0202', text: 'Pozemková kniha', state: 'next' }],
        working: o.working ? [{ who: 'agent-matriky', since: new Date(NOW.getTime() - 9 * 60_000).toISOString(), task: 'Sčítání 1900', person: 'P0002' }] : [],
        waiting: [{ id: 'T0101', what: 'Ověřit datum křtu v matrice', kind: 'web', at, order: 0, person: 'P0001', actions: ['answer'] }],
        features: ['waiting.answer'],
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.context().route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        if (path.endsWith('/status')) return route.fulfill(json(200, status()));
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel .live-panel-expand')).toBeVisible();
}

/** The overview's window from ⧉ in the overview's head (⤢ opens the overview here first). */
async function openOverviewWindow(page: Page): Promise<Page> {
    await expand(page).click();
    const winBtn = page.locator('#research-overview .research-overview__window');
    const [popup] = await Promise.all([page.waitForEvent('popup'), winBtn.click()]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    await expect(page.locator('#research-overview')).toBeHidden();
    return popup;
}

const panel = (page: Page) => page.locator('#live-panel');
const expand = (page: Page) => page.locator('#live-panel .live-panel-expand');
/** The panel's sections by their keys, in order. */
const sections = (page: Page) => panel(page).locator('.live-panel-body [aria-controls^="live-sec-"]')
    .evaluateAll(hs => hs.map(h => h.getAttribute('aria-controls')!.replace('live-sec-', '')));
const workingHead = (page: Page) => panel(page).locator('[aria-controls="live-sec-working"]');
const ALL = ['working', 'waiting', 'changes', 'queue'];

test.describe('the research panel beside the overview\'s own window', () => {
    test.use({ viewport: DESKTOP });

    test('at 1440: the head and Working only (expanded though folded in Customize panel); ⤢ brings the window forward; closed, the panel is whole again', async ({ page }) => {
        await follow(page, { working: true, prefs: { working: 'collapsed' } });
        await expect.poll(() => sections(page)).toEqual(ALL);
        await expect(workingHead(page)).toHaveAttribute('aria-expanded', 'false');

        const popup = await openOverviewWindow(page);
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).toHaveClass(/\bworking-only\b/);
        await expect.poll(() => sections(page)).toEqual(['working']);
        // Expanded beside the window, the agent's row in view; nothing of the other sections in the head either.
        await expect(workingHead(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(panel(page).locator('#live-sec-working')).toBeVisible();
        await expect(panel(page).locator('#live-sec-working')).toContainText('agent-matriky');
        // At work for 9 min by the fixed clock, in the overview's window the same "now".
        await expect(panel(page).locator('#live-sec-working')).toContainText('9 min');
        expect(await popup.evaluate(() => Date.now())).toBe(NOW.getTime());
        await expect(panel(page).locator('.live-panel-nowork, .live-panel-waitchip, .live-panel-allhidden')).toHaveCount(0);
        await expect(panel(page).locator('.live-panel-head .live-panel-title')).toHaveText('Vlasákovi z Horní Lhoty');
        await expect(panel(page).locator('.live-panel-action')).toHaveText('End following');

        // ⤢: the overview's window to the front, no overview here and no other window.
        await page.evaluate(() => {
            const reg = window.Strom.Windows as unknown as { focusWindow(id: string): Promise<boolean> };
            const focus = reg.focusWindow.bind(reg);
            (window as unknown as { __focused: number }).__focused = 0;
            reg.focusWindow = (id: string) => {
                (window as unknown as { __focused: number }).__focused++;
                return focus(id);
            };
        });
        const pages = page.context().pages().length;
        await expand(page).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __focused: number }).__focused)).toBe(1);
        await expect(page.locator('#research-overview')).toBeHidden();
        expect(page.context().pages().length).toBe(pages);
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(1);
        await expect.poll(() => sections(page)).toEqual(['working']);

        // Closed: every section again, Working folded as chosen.
        await popup.close();
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(0);
        await expect(panel(page)).not.toHaveClass(/\bworking-only\b/);
        await expect.poll(() => sections(page)).toEqual(ALL);
        await expect(workingHead(page)).toHaveAttribute('aria-expanded', 'false');
    });

    test('at 1440, nobody at work and Working hidden in Customize panel: "Nothing is being worked on now" in its place', async ({ page }) => {
        await follow(page, { working: false, prefs: { working: 'hidden' } });
        await expect.poll(() => sections(page)).toEqual(['waiting', 'changes', 'queue']);
        const popup = await openOverviewWindow(page);
        await expect(panel(page)).toHaveClass(/\bworking-only\b/);
        await expect(panel(page).locator('.live-panel-nowork')).toHaveText('Nothing is being worked on now');
        await expect.poll(() => sections(page)).toEqual([]);
        await expect(panel(page).locator('.live-panel-allhidden')).toHaveCount(0);
        await popup.close();
        await expect.poll(() => sections(page)).toEqual(['waiting', 'changes', 'queue']);
        await expect(panel(page).locator('.live-panel-nowork')).toHaveCount(0);
    });

    test('at a tablet\'s width the panel stays whole beside the window; wider than 1024, the head and Working only', async ({ page }) => {
        await follow(page, { working: false, viewport: TABLET });
        await expect.poll(() => sections(page)).toEqual(ALL);
        const popup = await openOverviewWindow(page);
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).not.toHaveClass(/\bworking-only\b/);
        await expect.poll(() => sections(page)).toEqual(ALL);
        await expect(panel(page).locator('.live-panel-nowork')).toHaveCount(0);
        // The main window widened past 1024 px: the head and Working only; narrowed again: whole.
        await page.setViewportSize(DESKTOP);
        await expect(panel(page)).toHaveClass(/\bworking-only\b/);
        await expect(panel(page).locator('.live-panel-nowork')).toHaveText('Nothing is being worked on now');
        await page.setViewportSize(TABLET);
        await expect(panel(page)).not.toHaveClass(/\bworking-only\b/);
        await expect.poll(() => sections(page)).toEqual(ALL);
        await popup.close();
    });
});
