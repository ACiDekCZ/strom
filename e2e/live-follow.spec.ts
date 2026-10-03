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
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@', '1 FAMC @F0000@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Václav /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1810', '1 REFN P0003', '1 FAMS @F0000@',
    '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @P0013@ INDI', '1 NAME Eva /Víšková/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
    '0 @F0000@ FAM', '1 HUSB @P0003@', '1 CHIL @P0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
    '0 TRLR',
].join('\n');

interface Bridge { person: string; paused: boolean }

async function follow(page: Page, o: { size?: { width: number; height: number }; gap?: number; idle?: number; on?: boolean } = {}): Promise<Bridge> {
    await page.setViewportSize(o.size ?? { width: 1440, height: 900 });
    await page.addInitScript(([links, gap, idle, on]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = { gap, idle, retry: 150 };
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        if (on) localStorage.setItem('strom-live-follow', '1');
    }, [LINKS, o.gap ?? 1200, o.idle ?? 2500, !!o.on] as const);
    const bridge: Bridge = { person: 'P0012', paused: false };
    const status = () => ({
        tree: { id: UUID, name: 'Víškovi' }, head: 'h1', persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky',
            ...(bridge.person ? { person: bridge.person } : {}),
            ...(bridge.paused ? { paused: { until: new Date(Date.now() + 3600_000).toISOString(), reason: 'limit' } } : {}) }],
        waiting: [], queue: [], links: LINKS,
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return bridge;
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
    test('on: from the fan to the family view, the worked-on person focused and centred', async ({ page }) => {
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
        const bridge = await follow(page, { gap: 6000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => {
            const r = window.Strom.TreeRenderer as unknown as { setFocus: (...a: unknown[]) => void; __calls: number };
            const orig = r.setFocus.bind(r);
            r.__calls = 0;
            r.setFocus = (...a: unknown[]) => { r.__calls++; orig(...a); };
        });
        bridge.person = 'P0001';
        await page.waitForTimeout(2500);
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

    test('Back to the agent: at once; ×: off', async ({ page }) => {
        const bridge = await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await dragTree(page);
        bridge.person = 'P0013';
        await page.waitForTimeout(2500);
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
        const bridge = await follow(page, { on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#settings-modal.active')).toBeVisible();
        bridge.person = 'P0001';
        await page.waitForTimeout(3500);
        expect(await focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
        await expect.poll(() => focusRefn(page)).toBe('P0001');
    });

    test('a run without a person, or paused: the tree stays where it is', async ({ page }) => {
        const bridge = await follow(page);
        bridge.person = '';
        await page.waitForTimeout(2500);
        const before = await focusRefn(page);
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('title', 'Stop following · waiting for the agent to work on someone');
        bridge.person = 'P0013';
        bridge.paused = true;
        await page.waitForTimeout(3000);
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
        const box = (await phoneBtn.boundingBox())!;
        expect(Math.round(box.width)).toBe(44);
        expect(Math.round(box.height)).toBe(44);
        await phoneBtn.click();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
        const pill = (await page.locator('#live-follow-pill').boundingBox())!;
        expect(pill.y + pill.height).toBeLessThanOrEqual(740 - 60);
    });
});
