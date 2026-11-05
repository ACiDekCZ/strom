import { test, expect, Page } from '@playwright/test';

/**
 * A live load of the research's tree without a blink (spec 055): the cards
 * never all go away while the new tree is drawn (Family and Descendants), the
 * cards that stay keep their element, a new person grows out of the line with
 * the light running down it, the motion setting and the system's reduced
 * motion leave only a short static ring, and a load changing more people than
 * the scene's limit draws at once. Invented data only.
 */

const UUID = '6b1d2e40-93a7-4c1f-8e25-4fd0a9c3b812';
const BRIDGE = 'http://127.0.0.1:5997/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };

const indi = (id: string, name: string, sex: 'M' | 'F', year: number, links: string[]) =>
    [`0 @${id}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${year}`, `1 REFN ${id}`, ...links];

function ged(o: { kids?: Array<[string, string, 'M' | 'F', number]>; } = {}): string {
    const kids = o.kids ?? [];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 1 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Hlohovci',
        ...indi('P0001', 'Radim /Hlohovec/', 'M', 1841, ['1 FAMS @F0001@', '1 FAMC @F0000@']),
        ...indi('P0002', 'Bohumila /Trnková/', 'F', 1844, ['1 FAMS @F0001@']),
        ...indi('P0003', 'Ctirad /Hlohovec/', 'M', 1812, ['1 FAMS @F0000@']),
        ...indi('P0012', 'Oldřich /Hlohovec/', 'M', 1866, ['1 FAMC @F0001@']),
        ...indi('P0013', 'Věnceslava /Hlohovcová/', 'F', 1869, ['1 FAMC @F0001@']),
        ...kids.flatMap(([id, name, sex, year]) => indi(id, name, sex, year, ['1 FAMC @F0001@'])),
        '0 @F0000@ FAM', '1 HUSB @P0003@', '1 CHIL @P0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
        ...kids.map(([id]) => `1 CHIL @${id}@`),
        '0 TRLR',
    ].join('\n');
}

interface Bridge { head: string; ged: string }

/** Follow a bridge whose tree is `bridge.ged`; a new `head` makes the app load it again. */
async function follow(page: Page, o: { motion?: boolean; reduced?: boolean; width?: number } = {}): Promise<Bridge> {
    await page.setViewportSize({ width: o.width ?? 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(([motion]) => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        if (!motion) localStorage.setItem('strom-live-motion', '0');
    }, [o.motion !== false] as const);
    await record(page);
    const bridge: Bridge = { head: 'h1', ged: ged() };
    const status = () => ({
        tree: { id: UUID, name: 'Hlohovci' }, head: bridge.head, persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky', person: 'P0012' }],
        waiting: [], queue: [],
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: bridge.ged });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(card(page, 'Oldřich')).toBeVisible();
    return bridge;
}

interface Rec {
    armed: boolean;
    /** The fewest cards seen at any mutation or frame since armed. */
    min: number;
    pulse: boolean;
    touched: boolean;
    staticMax: number;
    /** The most cards moved or grown by the scene's own animations (not CSS ones) at once. */
    animatedMax: number;
}

/**
 * Watch the tree area at every DOM mutation (the moment a card would be gone
 * before a redraw) and every frame: the fewest cards, the light, the rings,
 * the cards in the scene's motion.
 */
async function record(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const rec: Rec = { armed: false, min: Infinity, pulse: false, touched: false, staticMax: 0, animatedMax: 0 };
        (window as unknown as { __rec: Rec }).__rec = rec;
        const sample = () => {
            if (!rec.armed) return;
            rec.min = Math.min(rec.min, document.querySelectorAll('#tree-canvas .person-card').length);
            if (document.querySelector('.live-pulse-layer path')) rec.pulse = true;
            if (document.querySelector('.person-card.live-touched')) rec.touched = true;
            rec.staticMax = Math.max(rec.staticMax, document.querySelectorAll('.person-card.live-touched-static').length);
            const cards = new Set<Element>();
            for (const a of document.getAnimations()) {
                if (a instanceof CSSAnimation || a instanceof CSSTransition) continue;
                const t = (a.effect as KeyframeEffect | null)?.target;
                if (t instanceof Element && t.classList.contains('person-card')) cards.add(t);
            }
            rec.animatedMax = Math.max(rec.animatedMax, cards.size);
        };
        new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
        const frame = () => { sample(); requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
    });
}

const card = (page: Page, name: string) => page.locator('#tree-canvas .person-card', { hasText: name });
const rec = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Rec }).__rec);

/** Start watching, keep a card's element to compare after the load, and let the bridge give the new tree. */
async function load(page: Page, bridge: Bridge, next: string, keep = 'Věnceslava'): Promise<void> {
    await page.evaluate((name) => {
        const el = [...document.querySelectorAll('#tree-canvas .person-card')].find(c => c.textContent?.includes(name));
        (window as unknown as { __kept: Element | undefined }).__kept = el;
        (window as unknown as { __rec: Rec }).__rec.armed = true;
    }, keep);
    bridge.ged = next;
    bridge.head = `h${Number(bridge.head.slice(1)) + 1}`;
}

/** Whether the card kept before the load is still the same element in the tree. */
const keptSame = (page: Page, name = 'Věnceslava') => page.evaluate((n) => {
    const el = (window as unknown as { __kept: Element | undefined }).__kept;
    const now = [...document.querySelectorAll('#tree-canvas .person-card')].find(c => c.textContent?.includes(n));
    return !!el && el === now && el.isConnected;
}, name);

const ONE_MORE = ged({ kids: [['P0014', 'Lubor /Hlohovec/', 'M', 1872]] });

test.describe('live load without a blink (055)', () => {
    test('Family: no empty frame, the cards that stay keep their element, the new child grows with the light', async ({ page }) => {
        const bridge = await follow(page);
        await load(page, bridge, ONE_MORE);
        await expect(card(page, 'Lubor')).toBeVisible();
        await expect(page.locator('#live-announce')).toContainText('Person added: Lubor Hlohovec');
        await expect.poll(async () => (await rec(page)).animatedMax).toBeGreaterThan(0);
        const r = await rec(page);
        expect(r.min).toBeGreaterThan(0);
        expect(r.pulse).toBe(true);
        await expect.poll(async () => (await rec(page)).touched).toBe(true);
        expect(await keptSame(page)).toBe(true);
        // The scene ends: no layer, no ring is left behind.
        await expect(page.locator('.live-pulse-layer')).toHaveCount(0, { timeout: 4000 });
        await expect(page.locator('.person-card.live-touched')).toHaveCount(0, { timeout: 4000 });
    });

    test('Descendants: no empty frame, the cards that stay keep their element', async ({ page }) => {
        const bridge = await follow(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants'));
        await expect(card(page, 'Věnceslava')).toBeVisible();
        await load(page, bridge, ONE_MORE);
        await expect(card(page, 'Lubor')).toBeVisible();
        expect((await rec(page)).min).toBeGreaterThan(0);
        expect(await keptSame(page)).toBe(true);
    });

    test('a changed person: the card is redrawn in place and rings, the others keep their element', async ({ page }) => {
        const bridge = await follow(page);
        await load(page, bridge, ged().replace('2 DATE 1866', '2 DATE 1867'));
        await expect(card(page, 'Oldřich')).toContainText('1867');
        expect((await rec(page)).min).toBeGreaterThan(0);
        await expect.poll(async () => (await rec(page)).touched).toBe(true);
        expect(await keptSame(page)).toBe(true);
        await expect(page.locator('#live-announce')).toContainText('Person changed: Oldřich Hlohovec');
    });

    test('motion off in Settings: the new person stands at once with a short static ring', async ({ page }) => {
        const bridge = await follow(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const motion = page.locator('#settings-group-research-follow [data-key="live-motion"] input[type="checkbox"]');
        await expect(motion).toBeChecked();
        await motion.uncheck();
        expect(await page.evaluate(() => localStorage.getItem('strom-live-motion'))).toBe('0');
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-group-research-follow')).toBeHidden();
        await load(page, bridge, ONE_MORE);
        await expect(card(page, 'Lubor')).toBeVisible();
        await expect.poll(async () => (await rec(page)).staticMax).toBeGreaterThan(0);
        const r = await rec(page);
        expect(r.min).toBeGreaterThan(0);
        expect(r.pulse).toBe(false);
        expect(r.animatedMax).toBe(0);
        expect(await keptSame(page)).toBe(true);
        await expect(page.locator('.person-card.live-touched-static')).toHaveCount(0, { timeout: 4000 });
    });

    test('reduced motion: no motion whatever the setting, the setting says why', async ({ page }) => {
        const bridge = await follow(page, { reduced: true });
        await load(page, bridge, ONE_MORE);
        await expect(card(page, 'Lubor')).toBeVisible();
        await expect.poll(async () => (await rec(page)).staticMax).toBeGreaterThan(0);
        const r = await rec(page);
        expect(r.min).toBeGreaterThan(0);
        expect(r.pulse).toBe(false);
        expect(r.animatedMax).toBe(0);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const row = page.locator('#settings-group-research-follow [data-key="live-motion"]');
        await expect(row.locator('input[type="checkbox"]')).toBeDisabled();
        await expect(row.locator('[role="note"]')).toBeVisible();
    });

    test('over the limit: many new people stand at once, at most 12 rings, no blink', async ({ page }) => {
        const bridge = await follow(page);
        const many: Array<[string, string, 'M' | 'F', number]> = Array.from({ length: 70 }, (_, i) =>
            [`P${String(100 + i).padStart(4, '0')}`, `Dítě${i} /Hlohovec/`, i % 2 ? 'F' : 'M', 1870 + (i % 20)]);
        await load(page, bridge, ged({ kids: many }));
        await expect.poll(() => page.locator('#tree-canvas .person-card').count(), { timeout: 10000 }).toBeGreaterThan(70);
        await expect.poll(async () => (await rec(page)).staticMax).toBeGreaterThan(0);
        const r = await rec(page);
        expect(r.min).toBeGreaterThan(0);
        expect(r.pulse).toBe(false);
        expect(r.animatedMax).toBe(0);
        expect(r.staticMax).toBeLessThanOrEqual(12);
        await expect(page.locator('#live-announce')).toContainText('People added: 70');
    });

    test('a new person out of view: a notch at the edge, shown in full when focused during its fade-in, a click brings the person', async ({ page }) => {
        const bridge = await follow(page);
        const box = (await page.locator('#tree-container').boundingBox())!;
        // Drag the tree far to the left: the new youngest child lands beyond the left edge.
        for (const [from, to] of [[0.6, 0.02], [0.6, 0.02]]) {
            await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.5);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.5, { steps: 8 });
            await page.mouse.up();
        }
        await load(page, bridge, ged({ kids: [['P0014', 'Anastázie Leopoldina /Hlohovcová-Wartenberská/', 'F', 1890]] }));
        const notch = page.locator('.live-edge');
        await expect(notch).toHaveCount(1);
        await expect(notch).toHaveAttribute('aria-label', /Anastázie Leopoldina Hlohovcová-Wartenberská/);
        // Reached from the keyboard (focus-visible): a key first, as a keyboard user does.
        await page.keyboard.press('Shift');
        await notch.focus();
        await expect.poll(() => notch.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        await expect(notch.locator('.live-edge__tip')).toBeVisible();
        await notch.click();
        await expect(notch).toHaveCount(0);
        await expect(card(page, 'Anastázie')).toBeInViewport();
    });

    test('a manual tree open still draws in full (no live scene)', async ({ page }) => {
        await follow(page);
        await page.evaluate(() => { (window as unknown as { __rec: Rec }).__rec.armed = true; });
        await page.evaluate(() => window.Strom.TreeRenderer.render());
        await expect(card(page, 'Oldřich')).toBeVisible();
        const r = await rec(page);
        expect(r.pulse).toBe(false);
        expect(r.touched).toBe(false);
        expect(r.staticMax).toBe(0);
    });
});
