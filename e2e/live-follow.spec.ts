import { test, expect, Page } from '@playwright/test';

/**
 * "Follow the agent in the tree": the ◎ switch keeps the person the agent
 * works on focused and centred in the family view; one jump per brake, the
 * latest target wins; moving the tree pauses it (a pill) until Back or a
 * while without touching; dialogs hold the jump; the zoom stays unless too
 * far out; remembered over a reload; the phone strip. Timings are shortened
 * through `__LIVE_FOLLOW_MS`. Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['open', 'chat', 'task', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Fíškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@', '1 FAMC @F0000@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Václav /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1810', '1 REFN P0003', '1 FAMS @F0000@',
    '0 @P0012@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @P0013@ INDI', '1 NAME Eva /Fíšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
    '0 @F0000@ FAM', '1 HUSB @P0003@', '1 CHIL @P0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
    '0 TRLR',
].join('\n');

/**
 * The same family under a long surname, one child more: a family line (over
 * the small threshold) whose pill in the tree wraps on a phone.
 */
const LINE_GED = GED.replace(/\/Fíšek\/|\/Fíšková\//g, '/Brandvold-Ekhammarsson Lindenau/')
    .replace('0 @F0000@ FAM', ['0 @P0014@ INDI', '1 NAME Karl /Brandvold-Ekhammarsson Lindenau/', '1 SEX M', '1 BIRT', '2 DATE 1870', '1 REFN P0014', '1 FAMC @F0001@', '0 @F0000@ FAM'].join('\n'))
    .replace('1 CHIL @P0013@', '1 CHIL @P0013@\n1 CHIL @P0014@');

interface Bridge {
    person: string; paused: boolean;
    /** The asks of the reconnect chain so far (/events, /status): each comes after the one before it was read. */
    chain: number;
}

/**
 * Follow the bridge. `quick`: the app reconnects every 250 ms instead of 2 s
 * (__LIVE_RECONNECT_MS), so its next status comes soon (nextStatus).
 */
async function follow(page: Page, o: { size?: { width: number; height: number }; gap?: number; idle?: number; on?: boolean; quick?: boolean; ged?: string } = {}): Promise<Bridge> {
    await page.setViewportSize(o.size ?? { width: 1440, height: 900 });
    await page.addInitScript(([links, gap, idle, on, quick]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = { gap, idle, retry: 150 };
        if (quick) (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        if (on) localStorage.setItem('strom-live-follow', '1');
    }, [LINKS, o.gap ?? 1200, o.idle ?? 2500, !!o.on, !!o.quick] as const);
    const bridge: Bridge = { person: 'P0012', paused: false, chain: 0 };
    const status = () => ({
        tree: { id: UUID, name: 'Fíškovi' }, head: 'h1', persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky',
            ...(bridge.person ? { person: bridge.person } : {}),
            ...(bridge.paused ? { paused: { until: new Date(Date.now() + 3600_000).toISOString(), reason: 'limit' } } : {}) }],
        waiting: [], queue: [], links: LINKS,
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status') || path.endsWith('/events')) bridge.chain++;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: o.ged ?? GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return bridge;
}

/**
 * The bridge's next status, read by the app: two asks of the reconnect chain
 * after now (the first answers with what the bridge has now, the second is
 * asked only after the app read it).
 */
async function nextStatus(bridge: Bridge): Promise<void> {
    const n = bridge.chain;
    await expect.poll(() => bridge.chain, { timeout: 10000 }).toBeGreaterThanOrEqual(n + 2);
}

const idOf = (page: Page, refn: string) => page.evaluate((r) => Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === r)!.id, refn);
const focusRefn = (page: Page) => page.evaluate(() => window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId()!)?.refn ?? null);

/** How far the person's card is from the middle of the tree area (px, screen). */
async function offCentre(page: Page, refn: string): Promise<number> {
    return page.evaluate((r) => {
        const p = Object.values(window.Strom.DataManager.getData().persons).find(x => x.refn === r)!;
        const card = document.querySelector(`.person-card[data-id="${p.id}"]`)!.getBoundingClientRect();
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        return Math.hypot(card.left + card.width / 2 - (box.left + box.width / 2), card.top + card.height / 2 - (box.top + box.height / 2));
    }, refn);
}

async function setScale(page: Page, scale: number): Promise<void> {
    await page.evaluate((s) => {
        const z = window.Strom.ZoomPan as unknown as { scale: number; apply: () => void };
        z.scale = s;
        z.apply();
    }, scale);
}

/** Drag the empty canvas a little (the user takes the tree). */
async function dragTree(page: Page): Promise<void> {
    // An empty spot of the canvas (not a card, the minimap or a control).
    const { x, y } = await page.evaluate(() => {
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        for (let fy = 0.2; fy < 0.9; fy += 0.1) {
            for (let fx = 0.1; fx < 0.9; fx += 0.1) {
                const px = box.left + box.width * fx, py = box.top + box.height * fy;
                const el = document.elementFromPoint(px, py);
                if (el && (el.id === 'tree-container' || el.id === 'tree-canvas' || el.closest('#tree-lines'))) return { x: px, y: py };
            }
        }
        throw new Error('no empty spot');
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y - 20, { steps: 4 });
    await page.mouse.up();
}

const btn = (page: Page) => page.locator('#live-follow');

test.describe('follow the agent in the tree', () => {
    test('on: from the fan to the family view, the worked-on person focused and centred', { tag: '@smoke' }, async ({ page }) => {
        await follow(page);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(btn(page)).toHaveAttribute('aria-label', 'Follow the agent in the tree');
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await expect.poll(() => offCentre(page, 'P0012')).toBeLessThan(3);
        await expect(btn(page)).toHaveAttribute('aria-label', 'Stop following');
    });

    test('a new target: one jump after the brake, to the latest one', async ({ page }) => {
        const bridge = await follow(page, { gap: 6000, on: true, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => {
            const r = window.Strom.TreeRenderer as unknown as { setFocus: (...a: unknown[]) => void; __calls: number };
            const orig = r.setFocus.bind(r);
            r.__calls = 0;
            r.setFocus = (...a: unknown[]) => { r.__calls++; orig(...a); };
        });
        bridge.person = 'P0001';
        // Read within the brake, then the next one comes.
        await nextStatus(bridge);
        bridge.person = 'P0002';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0002');
        expect(await page.evaluate(() => (window.Strom.TreeRenderer as unknown as { __calls: number }).__calls)).toBe(1);
    });

    test('moving the tree pauses (pill, no jump); back by itself after a while without touching; a touch counts again', async ({ page }) => {
        const bridge = await follow(page, { idle: 3000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await dragTree(page);
        const pill = page.locator('#live-follow-pill');
        await expect(pill).toContainText('Following paused');
        await expect(btn(page)).toHaveClass(/is-paused/);
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        bridge.person = 'P0001';
        await page.waitForTimeout(2000);
        // A wheel over the tree starts the wait again.
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(2000);
        expect(await focusRefn(page)).toBe('P0012');
        await expect(pill).toBeVisible();
        await expect.poll(() => focusRefn(page), { timeout: 6000 }).toBe('P0001');
        await expect(pill).toHaveCount(0);
    });

    test('a drag that starts on a card pauses like one from the canvas (T38)', async ({ page }) => {
        // No brake (gap 0): only the pause can hold the jump.
        const bridge = await follow(page, { idle: 60_000, on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await expect.poll(() => offCentre(page, 'P0012')).toBeLessThan(3);
        const id = await idOf(page, 'P0012');
        const box = (await page.locator(`.person-card[data-id="${id}"]`).boundingBox())!;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 60, y - 20, { steps: 6 });
        await page.mouse.up();
        await expect(page.locator('#live-follow-pill')).toContainText('Following paused');
        await expect(btn(page)).toHaveClass(/is-paused/);
        // Paused: a new target does not move the tree.
        bridge.person = 'P0001';
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0012');
    });

    test('Back to the agent: at once; ×: off', async ({ page }) => {
        // No brake (gap 0): only the pause can hold the jump.
        const bridge = await follow(page, { idle: 60_000, on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await dragTree(page);
        bridge.person = 'P0013';
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0012');
        await page.locator('#live-follow-pill .live-follow-back').click();
        await expect.poll(() => focusRefn(page)).toBe('P0013');
        await dragTree(page);
        await page.locator('#live-follow-pill .evidence-pill-close').click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
    });

    test('focusing someone else pauses too', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const josef = await idOf(page, 'P0001');
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), josef);
        await expect(page.locator('#live-follow-pill')).toBeVisible();
    });

    test('an open dialog holds the jump until it closes', async ({ page }) => {
        // No brake (gap 0): only the dialog can hold the jump.
        const bridge = await follow(page, { on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#settings-modal.active')).toBeVisible();
        bridge.person = 'P0001';
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
        await expect.poll(() => focusRefn(page)).toBe('P0001');
    });

    test('a run without a person, or paused: the tree stays where it is', async ({ page }) => {
        const bridge = await follow(page, { quick: true });
        bridge.person = '';
        await nextStatus(bridge);
        const before = await focusRefn(page);
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('title', 'Stop following · waiting for the agent to work on someone');
        bridge.person = 'P0013';
        bridge.paused = true;
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe(before);
    });

    test('too far out: the jump reads (0.8); close enough: the zoom stays', async ({ page }) => {
        const bridge = await follow(page);
        await setScale(page, 0.4);
        await btn(page).click();
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(0.8, 2);
        // The glide ends first (a slow machine reaches 0.8 before the last frame, which would undo 1.2).
        await expect.poll(() => page.evaluate(() => (window.Strom.ZoomPan as unknown as { animationFrame: number | null }).animationFrame)).toBeNull();
        await setScale(page, 1.2);
        bridge.person = 'P0001';
        await expect.poll(() => focusRefn(page), { timeout: 6000 }).toBe('P0001');
        await expect.poll(() => offCentre(page, 'P0001')).toBeLessThan(3);
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(1.2, 5);
    });

    test('reduced motion: no glide, straight there', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await follow(page);
        await setScale(page, 0.4);
        await btn(page).click();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        // The first frame after the jump is already the end (no frames in between).
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(0.8);
        expect(await page.evaluate(() => (window.Strom.ZoomPan as unknown as { animationFrame: number | null }).animationFrame)).toBeNull();
    });

    test('remembered over a reload; F switches it', async ({ page }) => {
        await follow(page);
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await page.reload();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#tree-container').focus();
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('f');
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('overview: the switch beside ⤡', async ({ page }) => {
        await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        const head = page.locator('#research-overview .research-overview__head');
        await expect(head.locator('.live-follow-btn--overview')).toHaveAttribute('aria-pressed', 'false');
        await head.locator('.live-follow-btn--overview').click();
        await expect(head.locator('.live-follow-btn--overview')).toHaveAttribute('aria-pressed', 'true');
    });

    test('phone: a 44px switch in the strip, the pill above the bottom bar', async ({ page }) => {
        await follow(page, { size: { width: 360, height: 740 }, idle: 60_000 });
        const phoneBtn = page.locator('#live-panel .live-follow-btn--phone');
        await expect(phoneBtn).toBeVisible();
        // Each status from the bridge redraws the strip: a one-shot
        // boundingBox() between the old button going and the new one coming
        // read null. Measure the button that is there.
        await expect.poll(async () => {
            const box = await phoneBtn.boundingBox();
            return box && [Math.round(box.width), Math.round(box.height)];
        }).toEqual([44, 44]);
        await phoneBtn.click();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
        await expect.poll(async () => {
            const pill = await page.locator('#live-follow-pill').boundingBox();
            return pill ? pill.y + pill.height : Infinity;
        }).toBeLessThanOrEqual(740 - 60);
    });
    test('a family line shown in the tree: its pill and the paused pill stand clear of each other at every size, whichever came first (1031)', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true, ged: LINE_GED });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const live = page.locator('#live-follow-pill');
        const line = page.locator('#evidence-pill');
        const showLine = async (): Promise<void> => {
            await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId()!, { section: 'rods' }));
            const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
            await expect(sec).toHaveAttribute('data-ready', 'true');
            // The only line of the tree: its detail right away.
            await sec.getByRole('button', { name: 'Show in tree' }).click();
            await expect(line).toContainText('Brandvold-Ekhammarsson Lindenau family line');
        };
        /** The two pills, and each of them with the tree's chrome: what overlaps. */
        const clash = (): Promise<string[]> => page.evaluate(() => {
            const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            const pills = ['#evidence-pill', '#live-follow-pill'].map(sel => document.querySelector(sel)!.getBoundingClientRect());
            const out = hit(pills[0], pills[1]) ? ['pills'] : [];
            // The live panel too: on a phone its strip above the bottom bar, else its card at the top right (1031 D1, D2).
            for (const sel of ['#live-panel', '#focus-controls', '.descendants-badge', '.fan-toolbar', '.fan-zoom-controls', '.fan-legend', '.fan-legend-chip', '#fan-origin-pill', '.bottom-bar', '.zoom-controls', '.toolbar']) {
                for (const o of document.querySelectorAll(sel)) {
                    const b = o.getBoundingClientRect();
                    if (b.width > 0 && b.height > 0 && pills.some(p => hit(p, b))) out.push(sel);
                }
            }
            // The strip itself keeps clear of the bars and the zoom buttons (held sideways: right of the side bar).
            const strip = document.getElementById('live-panel')!.getBoundingClientRect();
            for (const sel of ['.bottom-bar', '.zoom-controls', '.fan-zoom-controls']) {
                for (const o of document.querySelectorAll(sel)) {
                    const b = o.getBoundingClientRect();
                    if (strip.width > 0 && b.width > 0 && b.height > 0 && hit(strip, b)) out.push(`strip × ${sel}`);
                }
            }
            if (document.documentElement.scrollWidth > window.innerWidth) out.push('scrollWidth');
            return out;
        });
        const sizes = [[390, 844], [360, 780], [360, 740], [844, 390], [640, 360], [1024, 768], [1440, 900]];
        // The paused pill first, then the line's (the order in the page differs from the other way round).
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
        await expect(live).toBeVisible();
        await showLine();
        for (const [w, h] of sizes) {
            await page.setViewportSize({ width: w, height: h });
            for (const mode of ['family', 'descendants', 'fan']) {
                await page.evaluate((m) => window.Strom.UI.setDisplayViewMode(m as 'family'), mode);
                await expect(page.locator('body')).toHaveAttribute('data-view-mode', mode);
                await expect.poll(clash, `live first, ${w}×${h} ${mode}`).toEqual([]);
            }
        }
        // The line's pill first, then the paused one: a phone upright and held sideways.
        await line.locator('.evidence-pill-close').click();
        await page.evaluate(() => window.Strom.UI.resumeLiveFollow());
        await expect(live).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
        await showLine();
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
        await expect(live).toBeVisible();
        for (const [w, h] of [[390, 844], [360, 780], [360, 740], [640, 360], [844, 390]]) {
            await page.setViewportSize({ width: w, height: h });
            await expect.poll(clash, `line first, ${w}×${h}`).toEqual([]);
        }
    });

    test('phone: the paused pill shows its whole text in every language, its height kept (1031)', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const pill = page.locator('#live-follow-pill');
        for (const lang of ['de', 'cs', 'en']) {
            // The pill takes its words when it comes: the language first.
            await page.evaluate(() => window.Strom.UI.resumeLiveFollow());
            await expect(pill).toHaveCount(0);
            await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
            await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
            await expect(pill).toBeVisible();
            for (const [w, h] of [[390, 844], [360, 780]]) {
                await page.setViewportSize({ width: w, height: h });
                const cut = await page.evaluate(() => {
                    const p = document.getElementById('live-follow-pill')!;
                    const out: string[] = [];
                    for (const part of p.querySelectorAll<HTMLElement>('.evidence-pill-label, .live-follow-back')) {
                        if (part.scrollWidth > part.clientWidth || part.scrollHeight > part.clientHeight) out.push(`cut: ${part.textContent}`);
                    }
                    const r = p.getBoundingClientRect();
                    if (r.right > window.innerWidth || p.scrollWidth > p.clientWidth) out.push('wider than the window');
                    // The highlight pill stands 58px above it (index.html): one row of 40px buttons.
                    if (r.height > 52) out.push(`height ${Math.round(r.height)}`);
                    return out;
                });
                expect(cut, `${lang} ${w}×${h}`).toEqual([]);
            }
            await page.setViewportSize({ width: 390, height: 844 });
        }
    });

    test('the fan view: the live card keeps below the fan toolbar, clear of its colours, steppers, the legend chip and the original person pill (1031)', async ({ page }) => {
        await follow(page, { size: { width: 1440, height: 900 }, idle: 60_000, on: true, ged: LINE_GED });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        // Re-centred on the father (it pauses following): the original person pill comes, and the paused pill.
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
        await expect(page.locator('#fan-origin-pill')).toBeVisible();
        await expect(page.locator('#live-follow-pill')).toBeVisible();
        const clash = (): Promise<string[]> => page.evaluate(() => {
            const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
            const card = document.getElementById('live-panel')!.getBoundingClientRect();
            const out: string[] = [];
            for (const el of document.querySelectorAll<HTMLElement>('#fan-toolbar > *, #fan-legend-chip, #fan-legend, #fan-origin-pill, #fan-zoom-controls, #live-follow-pill')) {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && b.height > 0 && hit(card, b)) out.push(el.id || el.className);
            }
            const origin = document.getElementById('fan-origin-pill')!.getBoundingClientRect();
            const paused = document.getElementById('live-follow-pill')!.getBoundingClientRect();
            if (hit(origin, paused)) out.push('fan-origin-pill × live-follow-pill');
            return out;
        });
        for (const [w, h] of [[1440, 900], [1024, 768], [800, 1000], [700, 1000], [844, 390]]) {
            await page.setViewportSize({ width: w, height: h });
            for (const shape of ['half', 'two']) {
                await page.evaluate((s) => window.Strom.TreeRenderer.setFanShape(s as 'half'), shape);
                await expect(page.locator('#fan-chart .fan-svg')).toHaveAttribute('data-fan-shape', shape);
                await expect.poll(clash, `${w}×${h} ${shape}`).toEqual([]);
            }
        }
    });

    test.describe('by touch', () => {
        test.use({ hasTouch: true });

        test('a line\'s pill with "Back to overview" (44px buttons) and the paused pill stand clear of each other on a tablet and held sideways (1031)', async ({ page }) => {
            await follow(page, { size: { width: 844, height: 390 }, idle: 60_000, on: true, ged: LINE_GED });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId()!, { section: 'rods' }));
            const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
            await expect(sec).toHaveAttribute('data-ready', 'true');
            await sec.getByRole('button', { name: 'Show in tree' }).click();
            const line = page.locator('#evidence-pill');
            await expect(line.locator('.evidence-pill-back')).toBeVisible();
            await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
            await expect(page.locator('#live-follow-pill')).toBeVisible();
            const clash = (): Promise<boolean> => page.evaluate(() => {
                const a = document.getElementById('evidence-pill')!.getBoundingClientRect();
                const b = document.getElementById('live-follow-pill')!.getBoundingClientRect();
                return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            });
            for (const [w, h] of [[844, 390], [800, 1000], [1024, 768]]) {
                await page.setViewportSize({ width: w, height: h });
                for (const mode of ['family', 'descendants', 'fan']) {
                    await page.evaluate((m) => window.Strom.UI.setDisplayViewMode(m as 'family'), mode);
                    await expect(page.locator('body')).toHaveAttribute('data-view-mode', mode);
                    await expect.poll(clash, `${w}×${h} ${mode}`).toBe(false);
                }
            }
        });
    });

    test('leaving the fan: the live card takes the height of the family view in the first frame (1101)', async ({ page }) => {
        await follow(page, { size: { width: 844, height: 390 }, idle: 60_000, on: true, ged: LINE_GED });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
        await expect(page.locator('#live-follow-pill')).toBeVisible();
        // In the fan the card stands lower and is fitted to that room.
        await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('live-panel')!.getBoundingClientRect().top))).toBeGreaterThan(90);
        const first = await page.evaluate(async () => {
            const p = document.getElementById('live-panel')!;
            window.Strom.UI.setDisplayViewMode('family');
            await new Promise(requestAnimationFrame);
            return Math.round(p.getBoundingClientRect().height);
        });
        await page.waitForTimeout(400);
        const later = await page.evaluate(() => {
            const p = document.getElementById('live-panel')!.getBoundingClientRect();
            const z = [...document.querySelectorAll('.zoom-controls, .control-block')].map(e => e.getBoundingClientRect())
                .filter(r => r.width > 0 && r.left < p.right && r.right > p.left);
            return { h: Math.round(p.height), clear: z.every(r => p.bottom <= r.top) };
        });
        expect(first).toBe(later.h);
        expect(later.clear).toBe(true);
    });

    test.describe('a phone, touch (1101)', () => {
        test.use({ hasTouch: true });

        const TOAST = 'Recherche Fíškovi aus Strom Research geöffnet — 6 Personen, 2 Familien (Stand 30.09.2026)';
        /** What the toast covers (pills, the strip, the fan's chrome), and whether it leaves the window. */
        const toastClash = (page: Page): Promise<string[]> => page.evaluate(() => {
            const t = document.querySelector('body > .toast.show')!.getBoundingClientRect();
            const out: string[] = [];
            for (const sel of ['#live-panel', '#evidence-pill', '#live-follow-pill', '#fan-origin-pill', '#fan-legend-chip', '#fan-toolbar', '.bottom-bar']) {
                const el = document.querySelector(sel);
                const b = el?.getBoundingClientRect();
                if (b && b.width > 0 && b.height > 0 && t.left < b.right && b.left < t.right && t.top < b.bottom && b.top < t.bottom) out.push(sel);
            }
            if (t.top < 0 || t.bottom > window.innerHeight) out.push('outside');
            return out;
        });

        test('a toast stands above the strip and the pills on it, upright and held sideways (1101)', async ({ page }) => {
            await follow(page, { size: { width: 640, height: 360 }, idle: 60_000, on: true, ged: LINE_GED });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            for (const paused of [false, true]) {
                if (paused) await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
                await expect(page.locator('#live-follow-pill')).toHaveCount(paused ? 1 : 0);
                for (const [w, h] of [[640, 360], [390, 844], [844, 390]]) {
                    await page.setViewportSize({ width: w, height: h });
                    for (const mode of ['family', 'fan']) {
                        await page.evaluate((m) => window.Strom.UI.setDisplayViewMode(m as 'family'), mode);
                        await expect(page.locator('body')).toHaveAttribute('data-view-mode', mode);
                        await page.evaluate((text) => window.Strom.UI.showToast(text, 10000), TOAST);
                        await expect(page.locator('body > .toast.show')).toBeVisible();
                        await expect.poll(() => toastClash(page), `${paused ? 'paused' : 'following'} ${w}×${h} ${mode}`).toEqual([]);
                    }
                }
                await page.setViewportSize({ width: 640, height: 360 });
            }
        });

        test('held sideways at 640×360 the fan stays in view: it ends above the strip, the paused pill folds into a chip on the top row (1101)', async ({ page }) => {
            await follow(page, { size: { width: 640, height: 360 }, idle: 60_000, on: true, ged: LINE_GED });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
            await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
            await expect(page.locator('#live-follow-pill')).toBeVisible();
            await expect(page.locator('#fan-origin-pill')).toBeVisible();
            const layout = (): Promise<string[]> => page.evaluate(() => {
                const rect = (sel: string) => {
                    const el = document.querySelector(sel);
                    const r = el?.getBoundingClientRect();
                    return r && r.width > 0 && r.height > 0 ? r : null;
                };
                const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                const sels = ['#live-follow-pill', '#fan-origin-pill', '#fan-legend-chip', '#fan-toolbar', '#live-panel', '#fan-zoom-controls'];
                const out: string[] = [];
                for (let i = 0; i < sels.length; i++) {
                    for (let j = i + 1; j < sels.length; j++) {
                        const a = rect(sels[i]), b = rect(sels[j]);
                        if (a && b && hit(a, b)) out.push(`${sels[i]} × ${sels[j]}`);
                    }
                }
                const chart = rect('#fan-chart')!, strip = rect('#live-panel')!;
                if (chart.bottom > strip.top) out.push('the fan under the strip');
                // Rows of the fan's surface no pill covers (its middle half: the corners are empty).
                const covers = ['#live-follow-pill', '#fan-origin-pill', '#fan-legend-chip', '#evidence-pill'].map(rect).filter((r): r is DOMRect => !!r)
                    .filter(r => r.right > chart.left + chart.width / 4 && r.left < chart.right - chart.width / 4);
                let free = 0;
                for (let y = Math.ceil(chart.top); y < chart.bottom; y++) if (!covers.some(r => r.top <= y && r.bottom > y)) free++;
                if (free < 0.6 * chart.height) out.push(`free ${free} of ${Math.round(chart.height)}`);
                for (const b of document.querySelectorAll<HTMLElement>('#live-follow-pill button')) {
                    if (b.getBoundingClientRect().height < 44) out.push(`small ${b.className}`);
                }
                if (window.innerWidth < document.documentElement.scrollWidth) out.push('scrollWidth');
                return out;
            });
            for (const lang of ['de', 'cs', 'en']) {
                await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
                await expect.poll(layout, lang).toEqual([]);
            }
            // The label is still there for a screen reader.
            await expect(page.locator('#live-follow-pill .evidence-pill-label')).toHaveText(/\S/);
            // Tablet held sideways and upright keep the full pill.
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(page.locator('#live-follow-pill .evidence-pill-label')).toBeVisible();
        });
    });
});
