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

/**
 * Anna's line upwards: her father, his mother, hers, hers and hers (Jan's
 * ancestor 110, beyond a fan of five generations around Jan, anchored at 55:
 * up and to the right, where the research's card stands at 1440).
 */
const DEEP_GED = GED.replace('0 TRLR', [
    '0 @P0101@ INDI', '1 NAME Tomáš /Zrzavý/', '1 SEX M', '1 REFN P0101', '1 FAMC @F0102@', '1 FAMS @F0101@',
    '0 @P0104@ INDI', '1 NAME Marta /Kvasnicová/', '1 SEX F', '1 REFN P0104', '1 FAMC @F0103@', '1 FAMS @F0102@',
    '0 @P0105@ INDI', '1 NAME Dora /Lojková/', '1 SEX F', '1 REFN P0105', '1 FAMC @F0104@', '1 FAMS @F0103@',
    '0 @P0107@ INDI', '1 NAME Klára /Lojková/', '1 SEX F', '1 REFN P0107', '1 FAMC @F0105@', '1 FAMS @F0104@',
    '0 @P0109@ INDI', '1 NAME Viktorie /Cibulková/', '1 SEX F', '1 REFN P0109', '1 FAMS @F0105@',
    '0 @F0101@ FAM', '1 HUSB @P0101@', '1 CHIL @P0002@',
    '0 @F0102@ FAM', '1 WIFE @P0104@', '1 CHIL @P0101@',
    '0 @F0103@ FAM', '1 WIFE @P0105@', '1 CHIL @P0104@',
    '0 @F0104@ FAM', '1 WIFE @P0107@', '1 CHIL @P0105@',
    '0 @F0105@ FAM', '1 WIFE @P0109@', '1 CHIL @P0107@',
    '0 TRLR'].join('\n'))
    .replace('1 REFN P0002\n1 FAMS @F0001@', '1 REFN P0002\n1 FAMC @F0101@\n1 FAMS @F0001@');

interface Bridge {
    person: string; paused: boolean;
    /** The family the first run works on (`working[].family`: a couple's task, e.g. a pair's narrative). */
    family?: string;
    /** The research's place record the first run works on (`working[].place`, read with `working.place`). */
    place?: string;
    /** `/status.features`. */
    features?: string[];
    /** More runs at work after the first one (two or more sessions). */
    more: Array<{ person: string; task: string; paused?: boolean; place?: string }>;
    /** The asks of the reconnect chain so far (/events, /status): each comes after the one before it was read. */
    chain: number;
    /** The research's head: a new one makes the app load the tree again (a live load). */
    head: string;
    /** The tree the bridge gives now (the `ged` option until changed). */
    ged: string;
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
    const bridge: Bridge = { person: 'P0012', paused: false, more: [], chain: 0, head: 'h1', ged: o.ged ?? GED };
    const status = () => ({
        tree: { id: UUID, name: 'Fíškovi' }, head: bridge.head, persons: 5,
        ...(bridge.features ? { features: bridge.features } : {}),
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky',
            ...(bridge.person ? { person: bridge.person } : {}),
            ...(bridge.family ? { family: bridge.family } : {}),
            ...(bridge.place ? { place: bridge.place } : {}),
            ...(bridge.paused ? { paused: { until: new Date(Date.now() + 3600_000).toISOString(), reason: 'limit' } } : {}) },
        ...bridge.more.map((m, i) => ({ who: `agent-${i + 2}`, since: new Date(Date.now() - 30_000).toISOString(), task: m.task, person: m.person,
            ...(m.place ? { place: m.place } : {}),
            ...(m.paused ? { paused: { until: new Date(Date.now() + 3600_000).toISOString(), reason: 'limit' } } : {}) }))],
        waiting: [], queue: [], links: LINKS,
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status') || path.endsWith('/events')) bridge.chain++;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: bridge.ged });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return bridge;
}

/** Map tiles served locally (a 1×1 PNG) and the one-time tiles notice acknowledged. */
async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.addInitScript(() => {
        const raw = localStorage.getItem('strom-settings');
        const settings = raw ? JSON.parse(raw) : {};
        settings.mapTiles = true;
        localStorage.setItem('strom-settings', JSON.stringify(settings));
    });
}

/**
 * Places for the map (invented): Jan born in Rybná, Josef in Habrov, Eva in
 * Lhota u Habrova (no position); the research's records L0003 farnost Habrov
 * (Habrov in the tree), L0007 Dolní Mez (a position on the record only),
 * L0009 Horní Mez (no position anywhere).
 */
async function seedMapPlaces(page: Page): Promise<void> {
    await page.evaluate(() => {
        const data = window.Strom.DataManager.getData();
        const by = (r: string) => Object.values(data.persons).find(p => p.refn === r)!;
        by('P0012').birthPlace = 'Rybná';
        by('P0001').birthPlace = 'Habrov';
        by('P0013').birthPlace = 'Lhota u Habrova';
        data.places = { rybna: { lat: 49.71, lon: 16.42 }, habrov: { lat: 49.8, lon: 16.5 } };
        data.placeRecords = {
            L0003: { id: 'L0003', names: [{ name: 'farnost Habrov' }], coords: { lat: 49.8, lon: 16.5 } },
            L0007: { id: 'L0007', names: [{ name: 'Dolní Mez' }], coords: { lat: 49.6, lon: 16.3 } },
            L0009: { id: 'L0009', names: [{ name: 'Horní Mez' }] },
        } as never;
        data.placeRefs = { habrov: 'L0003' };
    });
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

    test('a person the agent adds and works on: the live load brings the card, the focus goes to it (1105)', async ({ page }) => {
        const bridge = await follow(page, { on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        // The agent works on a person not in the app's tree yet: nothing to jump to.
        bridge.person = 'P0014';
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0012');
        // The live load brings the new person: the focus goes there and the card is centred.
        bridge.ged = GED.replace('0 @F0000@ FAM', ['0 @P0014@ INDI', '1 NAME Karel /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1871', '1 REFN P0014', '1 FAMC @F0001@', '0 @F0000@ FAM'].join('\n'))
            .replace('1 CHIL @P0013@', '1 CHIL @P0013@\n1 CHIL @P0014@');
        bridge.head = 'h2';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0014');
        await expect.poll(() => offCentre(page, 'P0014')).toBeLessThan(3);
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        // Another person of the tree next: the jump goes on as before.
        bridge.person = 'P0001';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0001');
    });

    test('a live load while following keeps the focus on the person worked on (1105)', async ({ page }) => {
        const bridge = await follow(page, { on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        bridge.person = 'P0013';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0013');
        // The agent writes (a new head, the same person worked on): the load does not take the focus away.
        bridge.ged = GED.replace('1 NAME Eva /Fíšková/', '1 NAME Eva Marie /Fíšková/');
        bridge.head = 'h2';
        await expect(page.locator('#tree-canvas .person-card', { hasText: 'Eva Marie' })).toBeVisible({ timeout: 10000 });
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0013');
        await expect.poll(() => offCentre(page, 'P0013')).toBeLessThan(3);
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
    });

    test('a run about a couple (a pair\'s narrative, the family and no person): the husband focused, the Now row names him (1105)', async ({ page }) => {
        const bridge = await follow(page, { on: true, gap: 0, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        bridge.person = '';
        bridge.family = 'F0001';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0001');
        await expect.poll(() => offCentre(page, 'P0001')).toBeLessThan(3);
        await expect(page.locator('#live-panel .live-working__person')).toContainText('Josef');
        // An older bridge naming the family in the person field: the same.
        bridge.family = undefined;
        bridge.person = 'P0013';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0013');
        bridge.person = 'F0001';
        await expect.poll(() => focusRefn(page), { timeout: 10000 }).toBe('P0001');
        // A family the tree does not know: the tree stays where it is.
        bridge.person = 'F0777';
        await nextStatus(bridge);
        expect(await focusRefn(page)).toBe('P0001');
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
        // Re-centred on the father: the original person pill comes; following goes on in the fan (spec 043).
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
        await expect(page.locator('#fan-origin-pill')).toBeVisible();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        // Paused (as from the family view): the paused pill too.
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
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
        // A tap in the fan does not pause following (spec 043): paused as from the family view.
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
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

        test('the back button stands above the strip and takes a tap, in the family view and the fan, upright and held sideways (1101)', async ({ page }) => {
            await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true, ged: LINE_GED });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            const navClash = (): Promise<string[]> => page.evaluate(() => {
                const rect = (el: Element | null) => {
                    const r = el?.getBoundingClientRect();
                    return r && r.width > 0 && r.height > 0 && getComputedStyle(el!).visibility !== 'hidden' ? r : null;
                };
                const out: string[] = [];
                for (const nav of ['#focus-back-btn', '#focus-forward-btn']) {
                    const n = rect(document.querySelector(nav));
                    if (!n) { if (nav === '#focus-back-btn') out.push('no back'); continue; }
                    if (n.top < 0 || n.bottom > window.innerHeight || n.left < 0 || n.right > window.innerWidth) out.push(`${nav} outside`);
                    const hit = document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2);
                    if (!hit?.closest(nav)) out.push(`${nav} under ${hit?.id || hit?.className}`);
                    for (const sel of ['#live-panel', '#evidence-pill', '#live-follow-pill', '#fan-origin-pill', '#fan-legend-chip', '#fan-legend',
                        '#fan-zoom-controls', '#fan-toolbar', '.zoom-controls', '.bottom-bar', '.tree-legend']) {
                        for (const el of document.querySelectorAll(sel)) {
                            const b = rect(el);
                            if (b && n.left < b.right && b.left < n.right && n.top < b.bottom && b.top < n.bottom) out.push(`${nav} × ${sel}`);
                        }
                    }
                }
                return out;
            });
            for (const paused of [false, true]) {
                if (paused) await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
                await expect(page.locator('#live-follow-pill')).toHaveCount(paused ? 1 : 0);
                for (const [w, h] of [[390, 844], [640, 360], [844, 390]]) {
                    await page.setViewportSize({ width: w, height: h });
                    for (const mode of ['family', 'fan']) {
                        await page.evaluate((m) => window.Strom.UI.setDisplayViewMode(m as 'family'), mode);
                        await expect(page.locator('body')).toHaveAttribute('data-view-mode', mode);
                        // A step to another person shows the back button.
                        const id = await idOf(page, 'P0013');
                        await page.evaluate((p) => window.Strom.TreeRenderer.setFocus(p as never), id);
                        await expect(page.locator('#focus-back-btn')).toBeVisible();
                        await expect.poll(navClash, `${paused ? 'paused' : 'following'} ${w}×${h} ${mode}`).toEqual([]);
                        // A tap goes back.
                        await page.locator('#focus-back-btn').click({ trial: false });
                        await expect.poll(() => focusRefn(page), `${w}×${h} ${mode}`).not.toBe('P0013');
                    }
                }
                await page.setViewportSize({ width: 390, height: 844 });
            }
        });

        test('held sideways at 640×360 the fan stays in view: it ends above the strip, the paused pill folds into a chip on the top row (1101)', async ({ page }) => {
            await follow(page, { size: { width: 640, height: 360 }, idle: 60_000, on: true, ged: LINE_GED });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
            await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
            await expect(page.locator('#fan-origin-pill')).toBeVisible();
            // A tap in the fan does not pause following (spec 043): paused as from the family view.
            await page.evaluate(() => window.Strom.UI.pauseLiveFollow());
            await expect(page.locator('#live-follow-pill')).toBeVisible();
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

test.describe('follow the agent in the fan (spec 043)', () => {
    const view = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getViewMode());
    const followView = (page: Page) => page.evaluate(() => window.Strom.UI.liveFollowView());
    const sector = (page: Page, id: string) => page.locator(`#fan-chart .fan-sector[data-fan-person="${id}"]`).first();
    const centre = (page: Page) => page.evaluate(() => document.querySelector('#fan-chart [data-fan-key="f"]')?.getAttribute('data-fan-person') ?? null);
    /** Count the signals started from now on (one per start: a redraw during a signal carries it on,
     *  and a signal started before the count, e.g. the arrival in the fan, is not counted). */
    const countPulses = (page: Page) => page.evaluate(() => {
        const w = window as unknown as { __pulses: Set<string>; __pulseWrap?: boolean; __pulseFrom: number };
        w.__pulses = new Set();
        w.__pulseFrom = performance.now();
        if (w.__pulseWrap) return;
        w.__pulseWrap = true;
        const ui = window.Strom.UI as unknown as { applyFanFollowMarks: (p?: Set<number>) => void };
        const draw = ui.applyFanFollowMarks;
        ui.applyFanFollowMarks = function (this: unknown, p?: Set<number>) {
            draw.call(this, p);
            for (const g of document.querySelectorAll('#fan-chart .fan-follow-layer .fan-work-glow.is-pulse')) {
                if (Number(g.getAttribute('data-pulse-at')) < w.__pulseFrom) continue;
                w.__pulses.add(`${g.getAttribute('data-pulse-at')}|${g.getAttribute('d') ?? 'f'}`);
            }
        };
    });
    const pulses = (page: Page) => page.evaluate(() => (window as unknown as { __pulses: Set<string> }).__pulses.size);

    test('the family view follows as before; "Follow in" switches to the fan without a pause, arrow keys choose; gone when following is off', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const row = page.locator('#live-panel .live-follow-view');
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute('role', 'radiogroup');
        await expect(row.locator('.live-follow-view__label')).toHaveText('Follow in');
        await expect(row.locator('[role="radio"]')).toHaveText(['Family', 'Fan', 'Map']);
        await expect(row.locator('[aria-checked="true"]')).toHaveText('Family');
        await row.locator('[role="radio"]', { hasText: 'Fan' }).click();
        await expect.poll(() => view(page)).toBe('fan');
        expect(await followView(page)).toBe('fan');
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#live-panel .live-follow-view [aria-checked="true"]')).toHaveText('Fan');
        // The person worked on is marked in the fan.
        // The fan centres on the person focused before following started (the person the tree opened on),
        // not on the one worked on: Jan is not drawn there, a chip names him.
        const before = await page.evaluate(() => window.Strom.UI.liveFollowFanCenter());
        expect(before).not.toBe(await idOf(page, 'P0012'));
        await expect.poll(() => centre(page)).toBe(before);
        await expect(page.locator('.fan-follow-overlay .fan-follow-chip')).toContainText('Jan');
        // Arrow keys: the choice moves and is made at once, the focus stays on the row.
        await page.locator('#live-panel .live-follow-view [aria-checked="true"]').focus();
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => view(page)).toBe('family');
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await expect(page.locator('#live-panel .live-follow-view [aria-checked="true"]')).toBeFocused();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        // The overview has it too.
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        await expect(page.locator('.live-follow-view--overview')).toBeVisible();
        await page.keyboard.press('Escape');
        // Off: no row.
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#live-panel .live-follow-view')).toHaveCount(0);
    });

    test('in the fan a tap on a sector keeps following; the descendants view pauses it; Back to the agent returns to the fan', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        expect(await followView(page)).toBe('fan');
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
        await expect(page.locator('#live-follow-pill')).toBeVisible();
        await page.locator('#live-follow-pill .live-follow-back').click();
        await expect.poll(() => view(page)).toBe('fan');
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
    });

    test('a session moving to another person signals once; the same person again does not; two sessions get their numbers', async ({ page }) => {
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        const jan = await idOf(page, 'P0012'), josef = await idOf(page, 'P0001'), anna = await idOf(page, 'P0002');
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), jan);
        await expect.poll(() => centre(page)).toBe(jan);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await countPulses(page);
        bridge.person = 'P0001';
        await nextStatus(bridge);
        await expect(sector(page, josef)).toHaveClass(/is-working/);
        await expect.poll(() => pulses(page)).toBe(1);
        await nextStatus(bridge);
        expect(await pulses(page)).toBe(1);
        // No numbers with one session.
        await expect(page.locator('#fan-chart .fan-work-num')).toHaveCount(0);
        await expect(page.locator('#live-panel .live-working-num')).toHaveCount(0);
        bridge.more = [{ person: 'P0002', task: 'T0102 Sčítání' }];
        await nextStatus(bridge);
        await expect(sector(page, anna)).toHaveClass(/is-working/);
        await expect(page.locator('#fan-chart .fan-work-num')).toHaveCount(2);
        await expect(page.locator('#fan-chart .fan-work-num.follow-primary')).toHaveCount(1);
        await expect(page.locator('#fan-chart .fan-work-num.follow-accent')).toHaveCount(1);
        await expect(page.locator('#live-panel .live-working-num')).toHaveText(['1', '2']);
        // Reduced motion: marked, no signal.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await countPulses(page);
        bridge.person = 'P0003';
        await nextStatus(bridge);
        await expect(sector(page, await idOf(page, 'P0003'))).toHaveClass(/is-working/);
        expect(await pulses(page)).toBe(0);
    });

    test('arriving in the fan signals once where the agent works: following on, the fan chosen, the app opened again, Back to the agent; an open sector menu holds it; none with reduced motion (1105)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await follow(page, { idle: 60_000 });
        const jan = await idOf(page, 'P0012');
        // Following runs in the fan around Jan (the Settings' own centre), so his disc is drawn.
        await page.evaluate((id) => {
            const tree = window.Strom.DataManager.getCurrentTreeId();
            localStorage.setItem('strom-live-follow-view', 'fan');
            localStorage.setItem('strom-live-follow-fan-center', 'person');
            localStorage.setItem(`strom-live-follow-fan-person:${tree}`, id);
        }, jan);
        await countPulses(page);
        // Following on: into the fan, a signal once.
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => view(page)).toBe('fan');
        await expect.poll(() => centre(page)).toBe(jan);
        await expect(page.locator('#fan-chart .is-working')).toHaveCount(1);
        await expect.poll(() => pulses(page)).toBe(1);
        const afterOn = 1;
        // Redraws (a zoom) carry nothing new.
        await page.locator('#fan-zoom-controls [data-fan-zoom-act="in"]').click();
        await page.waitForTimeout(400);
        expect(await pulses(page)).toBe(afterOn);
        // Family and the fan chosen again: once more.
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('family'));
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => pulses(page)).toBe(afterOn + 1);
        // The descendants view pauses; Back to the agent returns to the fan: once more.
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
        await expect(page.locator('#live-follow-pill')).toBeVisible();
        await page.locator('#live-follow-pill .live-follow-back').click();
        await expect.poll(() => view(page)).toBe('fan');
        await expect.poll(() => pulses(page)).toBe(afterOn + 2);
        // An open sector's menu holds the signal back until it closes.
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click({ button: 'right' });
        await expect(page.locator('.fan-menu')).toBeVisible();
        await page.evaluate(() => { window.Strom.UI.setLiveFollow(false); window.Strom.UI.setLiveFollow(true); });
        await page.waitForTimeout(300);
        await expect(page.locator('.fan-menu')).toBeVisible();
        expect(await pulses(page)).toBe(afterOn + 2);
        await page.keyboard.press('Escape');
        await expect(page.locator('.fan-menu')).toHaveCount(0);
        await expect.poll(() => pulses(page)).toBe(afterOn + 3);
        // The app opened again: once more.
        await page.reload();
        await expect(page.locator('#live-panel')).toBeVisible();
        expect(await view(page)).toBe('fan');
        await expect(page.locator('#fan-chart .fan-follow-layer .fan-work-glow[data-pulse-at]')).toHaveCount(1);
        // Reduced motion: marked, no signal.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await countPulses(page);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('family'));
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect(page.locator('#fan-chart .is-working')).toHaveCount(1);
        await page.waitForTimeout(300);
        expect(await pulses(page)).toBe(0);
    });

    test('arriving in the fan with the person worked on outside it: the label "Working outside the fan", no signal (1105)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await countPulses(page);
        // Eva's fan does not draw her brother Jan.
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), await idOf(page, 'P0013'));
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => centre(page)).toBe(await idOf(page, 'P0013'));
        await expect(page.locator('.fan-follow-overlay .fan-follow-chip')).toContainText('Jan');
        await page.waitForTimeout(400);
        expect(await pulses(page)).toBe(0);
        await expect(page.locator('.fan-follow-overlay .fan-follow-chip.is-pulse, .fan-follow-overlay .is-pulse')).toHaveCount(0);
    });

    test('the sector menu pins the centre; Release returns to the centre the rule gives', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        const before = await centre(page);
        const father = page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]');
        const fatherId = await father.getAttribute('data-fan-person');
        await father.click({ button: 'right' });
        await page.locator('.fan-menu [data-fan-menu="pin"]').click();
        await expect.poll(() => centre(page)).toBe(fatherId);
        const pin = page.locator('#fan-center-pin');
        await expect(pin).toBeVisible();
        await expect(pin.locator('.fan-center-pin-name')).toHaveText(/Fíšek/);
        expect(await page.evaluate(() => window.Strom.UI.liveFollowPinned())).toBe(fatherId);
        // The menu of the pinned centre offers Release.
        await page.locator('#fan-chart [data-fan-key="f"]').first().click({ button: 'right' });
        await expect(page.locator('.fan-menu [data-fan-menu="unpin"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await pin.locator('.fan-center-pin-release').click();
        await expect(pin).toBeHidden();
        await expect.poll(() => centre(page)).toBe(before);
        expect(await page.evaluate(() => window.Strom.UI.liveFollowPinned())).toBeNull();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
    });

    test('the centre\'s rule (§2.5): the focus before following, the user\'s own focus replaces it, a pin outlives a switch, Release, a tap shows the original person, off drops the pin (1105)', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const jan = await idOf(page, 'P0012'), eva = await idOf(page, 'P0013'), anna = await idOf(page, 'P0002');
        const opened = await page.evaluate(() => window.Strom.UI.liveFollowFanCenter());
        expect(opened).not.toBe(jan);
        // The user focuses Eva in the family view: the fan centres on her from now on.
        await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), eva);
        await expect(page.locator('#live-follow-pill')).toBeVisible();
        await page.locator('#live-follow-pill .live-follow-back').click();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => centre(page)).toBe(eva);
        // Pin Anna from her sector's menu: the fan re-centres there, the label names her.
        const annaSector = sector(page, anna);
        await annaSector.click({ button: 'right' });
        await page.locator('.fan-menu [data-fan-menu="pin"]').click();
        await expect.poll(() => centre(page)).toBe(anna);
        await expect(page.locator('#fan-center-pin .fan-center-pin-name')).toHaveText('Anna Svobodová');
        // Family and back: still Anna.
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('family'));
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => centre(page)).toBe(anna);
        // Release: back to Eva.
        await page.locator('#fan-center-pin .fan-center-pin-release').click();
        await expect.poll(() => centre(page)).toBe(eva);
        await expect(page.locator('#fan-center-pin')).toBeHidden();
        // A tap on Josef: a while there, the original person pill leads back to Eva.
        await page.locator('#fan-chart .fan-sector[data-fan-ahnentafel="2"]').click();
        await expect(page.locator('#fan-origin-pill')).toHaveAttribute('aria-label', 'Original person: Eva Fíšková');
        // Pin again, then following off: the pin is gone.
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), anna);
        expect(await page.evaluate(() => window.Strom.UI.liveFollowPinned())).toBe(anna);
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => window.Strom.UI.liveFollowPinned())).toBeNull();
        await expect(page.locator('#fan-center-pin')).toBeHidden();
    });

    test('a label of a person beyond the fan stands clear of the research\'s card (1440) (1105)', async ({ page }) => {
        const bridge = await follow(page, { idle: 60_000, on: true, ged: DEEP_GED });
        bridge.person = 'P0109';
        await nextStatus(bridge);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), await idOf(page, 'P0012'));
        await expect.poll(() => centre(page)).toBe(await idOf(page, 'P0012'));
        const chip = page.locator('.fan-follow-overlay .fan-follow-chip');
        await expect(chip).toContainText('Viktorie');
        await expect(page.locator('#live-panel')).toBeVisible();
        const hit = await page.evaluate(() => {
            const a = document.querySelector('.fan-follow-chip')!.getBoundingClientRect();
            const out: string[] = [];
            for (const sel of ['#live-panel', '#fan-legend', '#fan-legend-chip', '#fan-zoom-controls', '#fan-center-pin']) {
                const el = document.querySelector<HTMLElement>(sel);
                if (!el || el.hidden || !el.getClientRects().length) continue;
                const b = el.getBoundingClientRect();
                if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(sel);
            }
            const st = document.getElementById('fan-stage')!.getBoundingClientRect();
            if (a.left < st.left || a.right > st.right || a.top < st.top || a.bottom > st.bottom) out.push('outside the stage');
            return out;
        });
        expect(hit).toEqual([]);
    });

    test('the app opened again on the person the jump focused: the fan centres on the focus from before following, not on the agent\'s person (1105)', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        const jan = await idOf(page, 'P0012');
        const opened = await page.evaluate(() => window.Strom.UI.liveFollowFanCenter());
        expect(opened).not.toBe(jan);
        // The tree opens again on Jan, the person the last jump focused.
        await page.reload();
        await expect(page.locator('#live-panel')).toBeVisible();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => centre(page)).toBe(opened);
        // Jan is not drawn in a fan around his grandfather's line: the chip names him.
        await expect(page.locator('.fan-follow-overlay .fan-follow-chip')).toContainText('Jan');
        // Nothing kept for the tree: the tree's default person, never the agent's.
        await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('strom-live-follow-focus-before:')) localStorage.removeItem(k); });
        await page.reload();
        await expect(page.locator('#live-panel')).toBeVisible();
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        await expect.poll(() => centre(page)).not.toBe(jan);
        await expect.poll(() => centre(page)).not.toBeNull();
    });

    test('a person the fan does not draw (the centre\'s sister): a chip above the fan names her and the relation, no leader line across the rings; a click opens the family view there', async ({ page }) => {
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        const jan = await idOf(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), jan);
        await expect.poll(() => centre(page)).toBe(jan);
        bridge.person = 'P0013';
        await nextStatus(bridge);
        const chip = page.locator('.fan-follow-overlay button.fan-follow-chip');
        await expect(chip).toHaveCount(1);
        await expect(chip).toContainText('Eva');
        await expect(chip).toContainText('(sister)');
        await expect(page.locator('#fan-chart .is-working')).toHaveCount(0);
        await expect(page.locator('.fan-follow-leads .fan-follow-lead')).toHaveCount(0);
        await expect(page.locator('.fan-follow-leads .fan-follow-dot')).toHaveCount(1);
        const fits = await page.evaluate(() => {
            const c = document.querySelector('.fan-follow-chip')!.getBoundingClientRect();
            const s = document.getElementById('fan-chart')!.getBoundingClientRect();
            return c.left >= s.left - 0.5 && c.right <= s.right + 0.5 && c.top >= s.top - 0.5 && c.bottom <= s.bottom + 0.5;
        });
        expect(fits).toBe(true);
        await chip.click();
        await expect.poll(() => view(page)).toBe('family');
        await expect.poll(() => focusRefn(page)).toBe('P0013');
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        expect(await followView(page)).toBe('family');
    });

    test('Settings: the follow rows, a choice kept on the device, the chosen person for this tree, Restore defaults', async ({ page }) => {
        await follow(page, { idle: 60_000 });
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const group = page.locator('#settings-group-research-follow');
        await expect(group).toBeVisible();
        const set = (key: string) => group.locator(`.live-sec-set__row[data-key="${key}"]`);
        await expect(set('follow-view').locator('[aria-checked="true"]')).toHaveText('Family');
        await expect(set('follow-fan-center').locator('[aria-checked="true"]')).toHaveText('Focused person');
        await expect(set('follow-fan-person')).toHaveCount(0);
        await expect(group.locator('[data-key="follow-trail"] input[type="checkbox"]')).toBeChecked();
        await set('follow-view').locator('[role="radio"]', { hasText: 'Fan' }).click();
        await expect(set('follow-view').locator('[aria-checked="true"]')).toHaveText('Fan');
        expect(await page.evaluate(() => localStorage.getItem('strom-live-follow-view'))).toBe('fan');
        await set('follow-fan-center').locator('[role="radio"]', { hasText: 'Chosen person' }).click();
        const person = set('follow-fan-person');
        await expect(person).toBeVisible();
        await expect(person).toContainText('None chosen for this tree');
        await person.locator('.live-follow-person__btn').click();
        await page.locator('#live-follow-person-picker .person-picker-input').fill('Eva');
        await page.locator('#live-follow-person-picker .person-picker-item').first().click();
        await expect(set('follow-fan-person')).toContainText('Eva Fíšková');
        await expect(set('follow-fan-person')).toContainText('for the tree “Fíškovi”');
        const tree = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
        expect(await page.evaluate((t) => localStorage.getItem(`strom-live-follow-fan-person:${t}`), tree)).toBe(await idOf(page, 'P0013'));
        await group.locator('[data-key="follow-trail"] input[type="checkbox"]').uncheck();
        expect(await page.evaluate(() => localStorage.getItem('strom-live-follow-trail'))).not.toBeNull();
        await group.locator('.live-sec-reset').click();
        await expect(page.locator('.toast[data-kind="live-sections"]')).toContainText('Defaults restored');
        await expect(set('follow-view').locator('[aria-checked="true"]')).toHaveText('Family');
        await expect(set('follow-fan-person')).toHaveCount(0);
        await expect(group.locator('[data-key="follow-trail"] input[type="checkbox"]')).toBeChecked();
        expect(await page.evaluate(() => localStorage.getItem('strom-live-follow-view'))).toBeNull();
        // Undo brings them back.
        await page.locator('.toast[data-kind="live-sections"]').getByRole('button', { name: 'Undo' }).click();
        await expect(set('follow-view').locator('[aria-checked="true"]')).toHaveText('Fan');
        await expect(set('follow-fan-person')).toContainText('Eva Fíšková');
        // Following starts in the stored view.
        await page.keyboard.press('Escape');
        await btn(page).click();
        await expect.poll(() => view(page)).toBe('fan');
        expect(await followView(page)).toBe('fan');
    });

    test('the overview: the line about the switch has the same gap above and below; once it goes the summary closes up to "Follow in" (1105)', async ({ page }) => {
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const row = page.locator('.research-overview .live-follow-view--overview');
        await expect(row).toBeVisible();
        await page.mouse.move(10, 880);
        /** Gaps (px): "Follow in" → the line, the line → the summary; with no line "Follow in" → the summary. */
        const gaps = () => page.evaluate(() => {
            const r = document.querySelector('.research-overview .live-follow-view--overview')!.getBoundingClientRect();
            const sum = document.querySelector('.research-overview__summary')!.getBoundingClientRect();
            const n = document.querySelector('.research-overview .live-follow-note')?.getBoundingClientRect();
            return n ? { above: n.top - r.bottom, below: sum.top - n.bottom } : { none: sum.top - r.bottom };
        });
        // The line (said anew, its time counted from now) under "Follow in", over the summary.
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { noteLiveFollowStarted(s: unknown, from: unknown): void; renderResearchOverview(): void };
            // Following moved here from another tree (the open tree followed alone says nothing).
            const other = window.Strom.TreeManager.createTree('Vlkovi');
            ui.noteLiveFollowStarted({ treeId: window.Strom.DataManager.getCurrentTreeId(), name: 'Fíškovi' }, { followed: other, open: null });
            ui.renderResearchOverview();
        });
        const note = page.locator('.research-overview .live-follow-note');
        await expect(note).toBeVisible();
        const shown = await gaps();
        expect(shown.above!).toBeGreaterThan(4);
        expect(Math.abs(shown.above! - shown.below!)).toBeLessThanOrEqual(1);
        // The line goes by itself (FOLLOW_NOTICE_MS): the gap is the one of an overview drawn without it.
        await expect(note).toHaveCount(0, { timeout: 10_000 });
        const after = await gaps();
        await page.evaluate(() => (window.Strom.UI as unknown as { renderResearchOverview(): void }).renderResearchOverview());
        const plain = await gaps();
        expect(plain.none).toBeDefined();
        expect(Math.abs(after.none! - plain.none!)).toBeLessThanOrEqual(0.5);
        // No white strip between the two bands.
        expect(after.none!).toBeLessThan(2);
    });

    test.describe('a phone (spec 043)', () => {
        test.use({ hasTouch: true });

        test('"Follow in" is the strip\'s second row: 40px options, nothing wider than the window', async ({ page }) => {
            await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            const row = page.locator('#live-panel .live-follow-view--phone');
            await expect(row).toBeVisible();
            for (const lang of ['de', 'cs', 'pl', 'en']) {
                await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
                const bad = await page.evaluate(() => {
                    const out: string[] = [];
                    const r = document.querySelector('.live-follow-view--phone')!;
                    for (const o of r.querySelectorAll<HTMLElement>('[role="radio"]')) {
                        const b = o.getBoundingClientRect();
                        if (b.height < 40) out.push(`small ${o.textContent}`);
                        if (o.scrollWidth > o.clientWidth + 1) out.push(`cut ${o.textContent}`);
                    }
                    if (document.documentElement.scrollWidth > window.innerWidth) out.push('scrollWidth');
                    return out;
                });
                expect(bad, lang).toEqual([]);
            }
            await page.locator('#live-panel .live-follow-view--phone [role="radio"]').nth(1).tap();
            await expect.poll(() => view(page)).toBe('fan');
            await expect(page.locator('#live-follow-pill')).toHaveCount(0);
            // Held sideways the strip keeps one row: "Follow in" is in the overview sheet.
            await page.setViewportSize({ width: 844, height: 390 });
            await expect(row).toBeHidden();
            await page.evaluate(() => window.Strom.UI.openResearchOverview());
            const sheet = page.locator('.live-follow-view--overview');
            await expect(sheet).toBeVisible();
            await expect(sheet.locator('[aria-checked="true"]')).toHaveText('Fan');
        });
    });
});

test.describe('follow the agent on the map (spec 043 §5, §6)', () => {
    const work = (page: Page) => page.locator('#map-container .map-marker-work');
    /** Count the signals (pulses) started on the map from now on (one per start and ring: a pan or a zoom
     *  during a signal carries it on, and one started before the count, e.g. the arrival, is not counted). */
    const countMapPulses = (page: Page) => page.evaluate(() => {
        const w = window as unknown as { __mapPulses: Set<string>; __mapPulseWrap?: boolean; __mapPulseFrom: number };
        w.__mapPulses = new Set();
        w.__mapPulseFrom = performance.now();
        if (w.__mapPulseWrap) return;
        w.__mapPulseWrap = true;
        const ui = window.Strom.UI as unknown as { applyMapFollowMarks: (p?: Set<number>) => void };
        const draw = ui.applyMapFollowMarks;
        ui.applyMapFollowMarks = function (this: unknown, p?: Set<number>) {
            draw.call(this, p);
            for (const el of document.querySelectorAll<HTMLElement>('#map-container .map-marker-work.is-pulse')) {
                if (Number(el.dataset.pulseAt) < w.__mapPulseFrom) continue;
                w.__mapPulses.add(`${el.dataset.pulseAt}|${el.dataset.key}`);
            }
        };
    });
    const mapPulses = (page: Page) => page.evaluate(() => (window as unknown as { __mapPulses: Set<string> }).__mapPulses.size);
    /** Where an element's middle is, from the map's middle (px). */
    const offMapCentre = (page: Page, sel: string) => page.evaluate((s) => {
        const el = document.querySelector(s)!.getBoundingClientRect();
        const box = document.getElementById('map-container')!.getBoundingClientRect();
        return Math.hypot(el.left + el.width / 2 - (box.left + box.width / 2), el.top + el.height / 2 - (box.top + box.height / 2));
    }, sel);
    const errors = (page: Page): string[] => {
        const out: string[] = [];
        page.on('pageerror', e => out.push(e.message));
        return out;
    };

    test('with working.place the research\'s place record is marked (solid ring, its name beside it); a move to another place signals once and leaves a fainter trail', async ({ page }) => {
        const errs = errors(page);
        await stubTiles(page);
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        bridge.features = ['working.place'];
        bridge.place = 'L0003';
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await seedMapPlaces(page);
        await nextStatus(bridge);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(page.locator('#map-container .map-canvas')).toBeVisible();
        await expect(work(page)).toHaveCount(1);
        await expect(work(page)).toHaveClass(/is-record/);
        await expect(work(page)).toHaveAttribute('data-follow-session', '1');
        await expect(work(page).locator('.map-work-label b')).toHaveText('farnost Habrov');
        const ring = await work(page).locator('.map-work-ring').boundingBox();
        expect(Math.round(ring!.width)).toBe(44);
        // The bubble: the work in the place's bubble, the person a link to the family view.
        await work(page).locator('.map-work-ring').click();
        const popup = page.locator('#map-container .map-popup .map-popup-work');
        await expect(popup).toContainText('Work in progress');
        await expect(popup).toContainText('T0101 Matriky');
        await expect(popup.locator('.map-work-person')).toContainText('Jan');
        await page.locator('#map-container .map-popup-close').first().click();

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await countMapPulses(page);
        bridge.place = 'L0007';
        await nextStatus(bridge);
        await expect(work(page).locator('.map-work-label b')).toHaveText('Dolní Mez');
        await expect.poll(() => mapPulses(page)).toBe(1);
        // A place no fact of the tree names: outside the map's scope, a hollow dot in the ring.
        await expect(work(page)).toHaveClass(/is-outscope/);
        await expect(work(page).locator('.map-work-hollow')).toHaveCount(1);
        await nextStatus(bridge);
        expect(await mapPulses(page)).toBe(1);
        // The trail: Habrov before; the person's own place (Rybná) before that is fainter.
        bridge.place = undefined;
        bridge.person = 'P0001';
        await nextStatus(bridge);
        await expect(work(page).locator('.map-work-label b')).toHaveText('Habrov');
        const dots = page.locator('#map-container .map-trail-dot');
        await expect(dots).toHaveCount(1);
        expect(await dots.first().getAttribute('data-key')).toBe('#L0007');
        bridge.person = 'P0012';
        await nextStatus(bridge);
        await expect(dots).toHaveCount(2);
        const strength = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('#map-container .map-trail-dot')]
            .map(d => [d.dataset.key, Number(d.style.getPropertyValue('--trail-o'))])));
        expect(strength['habrov']).toBeGreaterThan(strength['#L0007']);
        await expect(page.locator('#map-container svg.map-trail-line line')).not.toHaveCount(0);
        // The legend opened by itself with the trail; its switch hides the trail.
        const legend = page.locator('#map-container #follow-legend .follow-legend-card');
        await expect(legend).toBeVisible();
        await legend.locator('.follow-legend-switch input').click();
        await expect(dots).toHaveCount(0);
        await expect(page.locator('#map-container svg.map-trail-line')).toHaveCount(0);
        await expect(work(page)).toHaveCount(1);
        expect(errs).toEqual([]);
    });

    test('without the feature the place field is not read: the person\'s own place, no crash', async ({ page }) => {
        const errs = errors(page);
        await stubTiles(page);
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        bridge.place = 'L0007';
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await seedMapPlaces(page);
        await nextStatus(bridge);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(work(page)).toHaveCount(1);
        await expect(work(page)).toHaveClass(/is-person/);
        await expect(work(page).locator('.map-work-label b')).toHaveText('Rybná');
        await expect(work(page)).toHaveAttribute('data-key', 'rybna');
        await expect(page.locator('#map-container .map-follow-notice')).toHaveCount(0);
        expect(errs).toEqual([]);
    });

    test('a place without a position: a notice at the top with Find position; a record without one: the notice alone', async ({ page }) => {
        await stubTiles(page);
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        bridge.features = ['working.place'];
        bridge.person = 'P0013';
        await expect.poll(() => focusRefn(page)).toBe('P0013');
        await seedMapPlaces(page);
        await nextStatus(bridge);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(page.locator('#map-container .map-canvas')).toBeVisible();
        const notice = page.locator('#map-container .map-follow-notice');
        await expect(notice).toHaveCount(1);
        await expect(notice).toHaveAttribute('data-follow-session', '1');
        await expect(notice.locator('b')).toHaveText('Lhota u Habrova');
        await expect(notice).toContainText('no position on the map');
        await expect(work(page)).toHaveCount(0);
        // Under the map's pills, never over them.
        const overlap = await page.evaluate(() => {
            const n = document.querySelector('.map-follow-notices')!.getBoundingClientRect();
            return [...document.querySelectorAll('.map-topleft > *, .map-controls, #live-follow-pill')].some(e => {
                const r = e.getBoundingClientRect();
                return r.height > 0 && r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top;
            });
        });
        expect(overlap).toBe(false);
        await notice.locator('.map-follow-locate').click();
        await expect(page.locator('#places-modal')).toBeVisible();
        await page.locator('#places-close-x').click();
        bridge.place = 'L0009';
        await nextStatus(bridge);
        await expect(notice.locator('b')).toHaveText('Horní Mez');
        await expect(notice.locator('.map-follow-locate')).toHaveCount(0);
    });

    test('moving the map pauses its panning (pill, ◎ paused); marks keep coming; Back to the agent centres the place', async ({ page }) => {
        await stubTiles(page);
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await seedMapPlaces(page);
        await nextStatus(bridge);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(work(page)).toHaveCount(1);
        const box = (await page.locator('#map-container').boundingBox())!;
        const x = box.x + box.width * 0.3, y = box.y + box.height * 0.65;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 300, y - 150, { steps: 6 });
        await page.mouse.up();
        const pill = page.locator('#live-follow-pill.live-follow-pill--map');
        await expect(pill).toBeVisible();
        await expect(pill).toContainText('Map panning paused');
        await expect(btn(page)).toHaveClass(/is-paused/);
        // Marks keep coming while paused; the map does not move.
        const centreBefore = await page.evaluate(() => JSON.stringify(window.Strom.UI.mapCenter));
        bridge.person = 'P0001';
        await nextStatus(bridge);
        await expect(work(page).locator('.map-work-label b')).toHaveText('Habrov');
        expect(await page.evaluate(() => JSON.stringify(window.Strom.UI.mapCenter))).toBe(centreBefore);
        await pill.locator('.live-follow-back').click();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        await expect(btn(page)).not.toHaveClass(/is-paused/);
        await expect.poll(() => offMapCentre(page, '#map-container .map-marker-work .map-work-ring')).toBeLessThan(40);
    });

    test('arriving on the map signals once where the agent works: following on, the map chosen, Back to the agent (after a pause and after the map moved by hand); a zoom does not; none with reduced motion (1105)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await stubTiles(page);
        await follow(page, { idle: 60_000, quick: true });
        await seedMapPlaces(page);
        await page.evaluate(() => localStorage.setItem('strom-live-follow-view', 'map'));
        await countMapPulses(page);
        // Following on: onto the map, its ring signals once.
        await btn(page).click();
        await expect(btn(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
        await expect(work(page)).toHaveCount(1);
        await expect(work(page).locator('.map-work-label b')).toHaveText('Rybná');
        await expect.poll(() => mapPulses(page)).toBe(1);
        // A zoom redraws the map: nothing new.
        await page.locator('#map-container .map-zoom-in').click();
        await page.waitForTimeout(400);
        expect(await mapPulses(page)).toBe(1);
        // Family and the map chosen again: once more.
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('family'));
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(work(page)).toHaveCount(1);
        await expect.poll(() => mapPulses(page)).toBe(2);
        // The map moved by hand pauses its panning; Back to the agent: once more.
        const box = (await page.locator('#map-container').boundingBox())!;
        const x = box.x + box.width * 0.3, y = box.y + box.height * 0.65;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 300, y - 150, { steps: 6 });
        await page.mouse.up();
        const pill = page.locator('#live-follow-pill');
        await expect(pill).toContainText('Map panning paused');
        await page.waitForTimeout(300);
        expect(await mapPulses(page)).toBe(2);
        await pill.locator('.live-follow-back').click();
        await expect(pill).toHaveCount(0);
        await expect.poll(() => mapPulses(page)).toBe(3);
        // The descendants view pauses following; Back to the agent returns to the map: once more.
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
        await expect(pill).toBeVisible();
        await pill.locator('.live-follow-back').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
        await expect(work(page)).toHaveCount(1);
        await expect.poll(() => mapPulses(page)).toBe(4);
        // Reduced motion: marked, no signal.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await countMapPulses(page);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('family'));
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(work(page)).toHaveCount(1);
        await page.waitForTimeout(300);
        expect(await mapPulses(page)).toBe(0);
        await expect(page.locator('#map-container .map-marker-work.is-pulse')).toHaveCount(0);
    });

    test('arriving on the map with the place worked on without a position: the notice alone, no signal (1105)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await stubTiles(page);
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        bridge.person = 'P0013';
        await expect.poll(() => focusRefn(page)).toBe('P0013');
        await seedMapPlaces(page);
        await nextStatus(bridge);
        await countMapPulses(page);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(page.locator('#map-container .map-follow-notice b')).toHaveText('Lhota u Habrova');
        await expect(work(page)).toHaveCount(0);
        await page.waitForTimeout(400);
        expect(await mapPulses(page)).toBe(0);
        await expect(page.locator('#map-container .is-pulse')).toHaveCount(0);
    });

    test('the fan keeps a trail of the people worked on before, older fainter; the legend\'s switch hides it', async ({ page }) => {
        const bridge = await follow(page, { idle: 60_000, on: true, quick: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('fan'));
        const jan = await idOf(page, 'P0012');
        await page.evaluate((id) => window.Strom.UI.pinFanCenter(id as never), jan);
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        for (const p of ['P0001', 'P0002', 'P0003']) {
            bridge.person = p;
            await nextStatus(bridge);
        }
        const trail = page.locator('#fan-chart .fan-follow-layer .fan-trail');
        await expect(trail).toHaveCount(3);
        const o = await page.evaluate(async (ids) => {
            const out: number[] = [];
            for (const id of ids) {
                const key = document.querySelector(`#fan-chart [data-fan-person="${id}"]`)?.getAttribute('data-fan-key');
                const el = document.querySelector<SVGElement>(`#fan-chart .fan-trail[data-trail-key="${key}"]`);
                out.push(el ? Number(el.style.getPropertyValue('--trail-o')) : -1);
            }
            return out;
        }, [await idOf(page, 'P0002'), await idOf(page, 'P0001'), jan]);
        expect(o[0]).toBeGreaterThan(o[1]);
        expect(o[1]).toBeGreaterThan(o[2]);
        expect(o[2]).toBeGreaterThan(0);
        // The sector worked on now carries the mark, not the trail.
        await expect(page.locator(`#fan-chart .fan-trail[data-trail-key="${await page.locator(`#fan-chart .fan-sector[data-fan-person="${await idOf(page, 'P0003')}"]`).first().getAttribute('data-fan-key')}"]`)).toHaveCount(0);
        const legend = page.locator('#follow-legend[data-view="fan"] .follow-legend-card');
        await expect(legend).toBeVisible();
        await expect(legend.locator('li')).toHaveCount(2);
        await legend.locator('.follow-legend-switch input').click();
        await expect(trail).toHaveCount(0);
        await legend.locator('.follow-legend-close').click();
        await expect(page.locator('#follow-legend button.follow-legend')).toBeVisible();
    });

    test('the research\'s card never covers the map\'s zoom buttons: left of it at 1440, 1024 and held sideways, as before on a phone (1105)', async ({ page }) => {
        const errs = errors(page);
        await stubTiles(page);
        await follow(page, { idle: 60_000, on: true });
        await expect.poll(() => focusRefn(page)).toBe('P0012');
        await seedMapPlaces(page);
        await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
        await expect(page.locator('#map-container .map-zoom-in')).toBeVisible();
        const clash = () => page.evaluate(() => {
            const p = document.getElementById('live-panel')!.getBoundingClientRect();
            const out: string[] = [];
            for (const b of document.querySelectorAll<HTMLElement>('#map-container .map-controls button')) {
                const r = b.getBoundingClientRect();
                if (r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom) out.push(`under ${b.className}`);
                const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (!at || !b.contains(at)) out.push(`hidden ${b.className}`);
            }
            const topleft = document.querySelector('#map-container .map-topleft')!.getBoundingClientRect();
            const zoom = document.querySelector('#map-container .map-controls')!.getBoundingClientRect();
            if (topleft.right > zoom.left) out.push('scope over the zoom buttons');
            if (document.documentElement.scrollWidth > window.innerWidth) out.push('scrollWidth');
            return out;
        });
        const zoom = () => page.evaluate(() => (window.Strom.UI as unknown as { mapZoom: number }).mapZoom);
        for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(size);
            await expect(page.locator('#live-panel')).toBeVisible();
            await expect.poll(clash, { message: `${size.width}` }).toEqual([]);
        }
        // Reachable: a click on + zooms the map (no element over it).
        await page.setViewportSize({ width: 1024, height: 768 });
        await expect.poll(clash).toEqual([]);
        const before = await zoom();
        await page.locator('#map-container .map-zoom-in').click({ timeout: 3000 });
        await expect.poll(zoom).toBe(before + 1);
        // A phone: the strip is at the bottom, the buttons stay at the map's right edge.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator('#live-panel.phone-strip')).toBeVisible();
        expect(await page.evaluate(() => {
            const m = document.getElementById('map-container')!.getBoundingClientRect();
            return Math.round(m.right - document.querySelector('#map-container .map-controls')!.getBoundingClientRect().right);
        })).toBe(8);
        expect(errs).toEqual([]);
    });

    test.describe('a phone (spec 043 §8)', () => {
        test.use({ hasTouch: true });

        test('the map\'s work ring without its label, no trail and no legend', async ({ page }) => {
            const errs = errors(page);
            await stubTiles(page);
            const bridge = await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true, quick: true });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await seedMapPlaces(page);
            await nextStatus(bridge);
            await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
            await expect(work(page)).toHaveCount(1);
            await expect(work(page).locator('.map-work-label')).toBeHidden();
            bridge.person = 'P0001';
            await nextStatus(bridge);
            await expect(work(page)).toHaveAttribute('data-key', 'habrov');
            await expect(page.locator('#map-container .map-trail-dot')).toHaveCount(0);
            await expect(page.locator('#follow-legend')).toHaveCount(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            expect(errs).toEqual([]);
        });

        test('a toast on the map stands above the map\'s status bar ("without a position"), not over it (1105)', async ({ page }) => {
            const errs = errors(page);
            await stubTiles(page);
            await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true });
            await expect.poll(() => focusRefn(page)).toBe('P0012');
            await seedMapPlaces(page);
            await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
            const status = page.locator('#map-container .map-status');
            await expect(status).toBeVisible();
            await expect(page.locator('#live-panel.phone-strip')).toBeVisible();
            await page.evaluate(() => window.Strom.UI.showToast('Fíškovi: 4 osoby, 1 rodina', 10000));
            const toast = page.locator('body > .toast.show');
            await expect(toast).toBeVisible();
            await expect.poll(() => page.evaluate(() => {
                const t = document.querySelector('body > .toast.show')!.getBoundingClientRect();
                const s = document.querySelector('#map-container .map-status')!.getBoundingClientRect();
                return Math.round(s.top - t.bottom);
            })).toBeGreaterThanOrEqual(4);
            expect(errs).toEqual([]);
        });

        test('a place without a position: the notice and the map\'s status bar stand above the research strip, Find position a 44px target', async ({ page }) => {
            const errs = errors(page);
            await stubTiles(page);
            const bridge = await follow(page, { size: { width: 390, height: 844 }, idle: 60_000, on: true, quick: true });
            bridge.features = ['working.place'];
            bridge.person = 'P0013';
            await expect.poll(() => focusRefn(page)).toBe('P0013');
            await seedMapPlaces(page);
            await nextStatus(bridge);
            await page.evaluate(() => window.Strom.UI.setLiveFollowView('map'));
            const notice = page.locator('#map-container .map-follow-notice');
            await expect(notice).toHaveCount(1);
            await expect(page.locator('#live-panel.phone-strip')).toBeVisible();
            /** What the strip (fixed, over the map) covers, and what is cut off by the window. */
            const covered = () => page.evaluate(() => {
                const strip = document.getElementById('live-panel')!.getBoundingClientRect();
                const out: string[] = [];
                const els = ['.map-follow-notice', '.map-follow-locate', '.map-status'].map(s => [s, document.querySelector(s)] as const);
                for (const [sel, el] of els) {
                    if (!el) { out.push(`missing ${sel}`); continue; }
                    const r = el.getBoundingClientRect();
                    if (r.height === 0) { out.push(`hidden ${sel}`); continue; }
                    const w = Math.min(r.right, strip.right) - Math.max(r.left, strip.left);
                    const h = Math.min(r.bottom, strip.bottom) - Math.max(r.top, strip.top);
                    if (w > 0 && h > 0) out.push(`under the strip ${sel}`);
                    if (r.left < 0 || r.right > window.innerWidth || r.top < 0) out.push(`cut ${sel}`);
                }
                const n = document.querySelector('.map-follow-notice')!.getBoundingClientRect();
                const st = document.querySelector('.map-status')!.getBoundingClientRect();
                if (n.bottom > st.top) out.push('notice over the status bar');
                const b = document.querySelector('.map-follow-locate')!.getBoundingClientRect();
                if (b.height < 44) out.push(`locate ${b.height}px`);
                // Back / forward float over the status bar's left end, never over its sentence or buttons.
                for (const nav of document.querySelectorAll<HTMLElement>('.focus-nav-btn')) {
                    const v = nav.getBoundingClientRect();
                    if (v.height === 0) continue;
                    for (const c of document.querySelectorAll('.map-status > *')) {
                        const r = c.getBoundingClientRect();
                        if (r.height > 0 && r.left < v.right && r.right > v.left && r.top < v.bottom && r.bottom > v.top) out.push(`${nav.id} over ${c.className}`);
                    }
                }
                if (document.documentElement.scrollWidth > window.innerWidth) out.push('scrollWidth');
                return out;
            });
            for (const lang of ['cs', 'de', 'en']) {
                await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
                await expect.poll(covered, { message: lang }).toEqual([]);
            }
            await notice.locator('.map-follow-locate').tap();
            await expect(page.locator('#places-modal')).toBeVisible();
            expect(errs).toEqual([]);
        });
    });
});
