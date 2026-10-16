import { test, expect, Page, Route } from '@playwright/test';
import { openApp, waitForPersist, PACKAGE_VERSION } from './helpers.js';
import { openResearch, fakeBridge, poll, FakeBridge, BRIDGE } from './research-bridge.js';

/**
 * "What's new" of Strom Research in the app: when the bridge of the linked
 * research says a newer version than the one seen on this computer and that
 * it answers `/whats-new`, the dialog shows the research's points (alone, or
 * under the app's); a link made in the page only records the version, a
 * research linked before the page started is told its first version too; an
 * older bridge is never asked; an open from the research (?live=) shows the
 * research's section alone and keeps the app's for the next usual start.
 * About shows "Research X.Y.Z • What's new ↗". Nothing on a phone. The bridge
 * is answered by page.route (invented data).
 */

const APP_SEEN_KEY = 'strom-whats-new-seen';
const SEEN_KEY = 'strom-research-whats-new-seen';
const OLDER_APP = '3.0.0';
const SEEN = '1.14.0';
const NEW = '1.15.0-beta.6';
const URL = 'https://github.com/ACiDekCZ/strom-research/blob/beta/CHANGELOG.md#1150';
/** The first look comes 1.2 s after the first render, waiting up to 1.5 s for the research; this is well past it. */
const PAST_FIRST_CHECK_MS = 3500;

const dialog = (page: Page) => page.locator('#release-notes-modal');
const getKey = (page: Page, k: string) => page.evaluate((key) => localStorage.getItem(key), k);
const setKey = (page: Page, k: string, v: string | null) => page.evaluate(([key, value]) => {
    if (value === null) localStorage.removeItem(key as string);
    else localStorage.setItem(key as string, value);
}, [k, v] as const);

interface WhatsNew { asks: URL[]; body: unknown }

/** The bridge's `/whats-new` (registered after fakeBridge, so it goes first). */
async function whatsNewRoute(page: Page, body: unknown): Promise<WhatsNew> {
    const w: WhatsNew = { asks: [], body };
    await page.route((u) => u.pathname.endsWith('/whats-new'), (route: Route) => {
        w.asks.push(new globalThis.URL(route.request().url()));
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(w.body) });
    });
    return w;
}

/** A research tree linked to the fake bridge, stored, with the research's version seen here (null: never). */
async function linked(page: Page, opts: { strom?: string; features?: string[]; seen: string | null; points?: string[]; down?: boolean }): Promise<{ b: FakeBridge; w: WhatsNew }> {
    const b = await fakeBridge(page, { strom: opts.strom ?? NEW, features: opts.features ?? ['whats.new'], down: opts.down });
    const w = await whatsNewRoute(page, {
        version: opts.strom ?? NEW, lang: 'en', url: URL,
        points: opts.points ?? ['**Archive by choice.** The setup asks first.', 'After `strom update` a link to this overview.'],
    });
    await openResearch(page);
    await waitForPersist(page, 'Svobodová');
    await setKey(page, SEEN_KEY, opts.seen);
    return { b, w };
}

async function reload(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

test.describe('Strom Research in "What\'s new" (computer)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a newer research: a dialog with its section only; points as text; seen once closed', { tag: '@smoke' }, async ({ page }) => {
        const { w } = await linked(page, {
            seen: SEEN,
            points: ['**New**: after `strom update` a link.', '<img src=x onerror="window.__xss=1"> and <b>bold</b>'],
        });
        await reload(page);

        const d = dialog(page);
        await expect(d).toBeVisible();
        await expect(d.getByRole('heading', { name: 'What\'s new' })).toBeVisible();
        // No app section: the header names no app version.
        await expect(d.locator('.release-notes-version')).toHaveCount(0);
        await expect(d.getByRole('heading', { name: `Research ${NEW}` })).toBeVisible();
        const items = d.locator('.release-notes-research li');
        await expect(items).toHaveCount(2);
        await expect(items.first().locator('strong')).toHaveText('New');
        await expect(items.first().locator('code')).toHaveText('strom update');
        // HTML from the bridge is text, never markup.
        await expect(items.nth(1)).toHaveText('<img src=x onerror="window.__xss=1"> and <b>bold</b>');
        await expect(d.locator('img, b')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
        const all = d.getByRole('link', { name: 'All research changes ↗' });
        await expect(all).toHaveAttribute('href', URL);
        await expect(all).toHaveAttribute('target', '_blank');
        await expect(all).toHaveAttribute('rel', 'noopener noreferrer');
        // Asked once, in the UI language, with the app's version.
        expect(w.asks).toHaveLength(1);
        expect(w.asks[0].searchParams.get('lang')).toBe('en');
        expect(w.asks[0].searchParams.get('app')).toBe(PACKAGE_VERSION);

        await page.keyboard.press('Escape');
        await expect(d).toHaveCount(0);
        expect(await getKey(page, SEEN_KEY)).toBe(NEW);
        expect(await getKey(page, APP_SEEN_KEY)).toBe(PACKAGE_VERSION);

        await reload(page);
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(d).toHaveCount(0);
        expect(w.asks).toHaveLength(1);
    });

    test('the app and the research both new: one dialog, the app on top, both seen once closed', async ({ page }) => {
        await linked(page, { seen: SEEN });
        await setKey(page, APP_SEEN_KEY, OLDER_APP);
        await reload(page);

        const d = dialog(page);
        await expect(d.locator('.release-notes-research')).toBeVisible();
        await expect(d.locator('.release-notes-version')).toHaveText(`Strom ${PACKAGE_VERSION}`);
        await expect(d.getByRole('link', { name: 'All changes ↗' })).toBeVisible();
        // The app's points first, the research's section after them.
        const order = await d.locator('.release-notes-content').evaluate((c) =>
            [...c.children].map(n => n.classList.contains('release-notes-research') ? 'research' : n.tagName === 'UL' ? 'app' : 'other'));
        expect(order.indexOf('app')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('app')).toBeLessThan(order.indexOf('research'));

        await d.locator('.release-notes-close').click();
        await expect(d).toHaveCount(0);
        expect(await getKey(page, APP_SEEN_KEY)).toBe(PACKAGE_VERSION);
        expect(await getKey(page, SEEN_KEY)).toBe(NEW);
    });

    test('the research answering while the app\'s dialog is open: its section joins it', async ({ page }) => {
        const { b } = await linked(page, { seen: SEEN, down: true });
        await setKey(page, APP_SEEN_KEY, OLDER_APP);
        await reload(page);
        const d = dialog(page);
        await expect(d.locator('.release-notes-version')).toBeVisible();
        await expect(d.locator('.release-notes-research')).toHaveCount(0);

        b.down = false;
        await poll(page);
        await expect(d.getByRole('heading', { name: `Research ${NEW}` })).toBeVisible();
        await d.locator('.release-notes-close').click();
        expect(await getKey(page, SEEN_KEY)).toBe(NEW);
    });

    test('the app\'s dialog already closed in this page: the research\'s section waits for the next start', async ({ page }) => {
        const { b, w } = await linked(page, { seen: SEEN, down: true });
        await setKey(page, APP_SEEN_KEY, OLDER_APP);
        await reload(page);
        const d = dialog(page);
        await expect(d).toBeVisible();
        await d.locator('.release-notes-close').click();
        await expect(d).toHaveCount(0);

        b.down = false;
        await poll(page);
        await expect.poll(() => w.asks.length).toBe(1);
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(d).toHaveCount(0);
        expect(await getKey(page, SEEN_KEY)).toBe(SEEN);

        await reload(page);
        await expect(d.getByRole('heading', { name: `Research ${NEW}` })).toBeVisible();
    });

    test('the first link to a research, made in this page: no dialog, no question, its version recorded', async ({ page }) => {
        const { w } = await linked(page, { seen: null });
        await poll(page);
        await expect.poll(() => getKey(page, SEEN_KEY)).toBe(NEW);
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(dialog(page)).toHaveCount(0);
        expect(w.asks).toHaveLength(0);
    });

    test('a research linked before this start, its version never seen here: the dialog with its section', async ({ page }) => {
        const { w } = await linked(page, { seen: null });
        await reload(page);
        const d = dialog(page);
        await expect(d.getByRole('heading', { name: `Research ${NEW}` })).toBeVisible();
        await expect(d.locator('.release-notes-version')).toHaveCount(0);
        expect(w.asks).toHaveLength(1);
        await d.locator('.release-notes-close').click();
        await expect(d).toHaveCount(0);
        expect(await getKey(page, SEEN_KEY)).toBe(NEW);
    });

    test('an open from the research (?live=) with the app and the research both new: the research\'s section alone, the app\'s at the next usual start', async ({ page }) => {
        const { w } = await linked(page, { seen: SEEN });
        await setKey(page, APP_SEEN_KEY, OLDER_APP);
        await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);

        const d = dialog(page);
        await expect(d.getByRole('heading', { name: `Research ${NEW}` })).toBeVisible();
        await expect(d.locator('.release-notes-version')).toHaveCount(0);
        await expect(d.getByRole('link', { name: 'All changes ↗' })).toHaveCount(0);
        expect(w.asks).toHaveLength(1);
        await d.locator('.release-notes-close').click();
        await expect(d).toHaveCount(0);
        expect(await getKey(page, SEEN_KEY)).toBe(NEW);
        // The app's version stays unrecorded: nothing more in this page.
        expect(await getKey(page, APP_SEEN_KEY)).toBe(OLDER_APP);
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(d).toHaveCount(0);

        // The next usual start: not the same tab resuming the live follow.
        await page.evaluate(() => sessionStorage.removeItem('strom.live'));
        await page.goto('/strom.html');
        await expect(d.locator('.release-notes-version')).toHaveText(`Strom ${PACKAGE_VERSION}`);
        await expect(d.locator('.release-notes-research')).toHaveCount(0);
        await d.locator('.release-notes-close').click();
        expect(await getKey(page, APP_SEEN_KEY)).toBe(PACKAGE_VERSION);
        expect(w.asks).toHaveLength(1);
    });

    test('a bridge without "whats.new": never asked, no dialog; About shows its version without a link', async ({ page }) => {
        const { w } = await linked(page, { seen: SEEN, strom: '1.15.0-beta.5', features: [] });
        await reload(page);
        await expect.poll(() => getKey(page, SEEN_KEY)).toBe('1.15.0-beta.5');
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(dialog(page)).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        const row = page.locator('#about-modal .about-research');
        await expect(row).toHaveText('Research 1.15.0-beta.5');
        await expect(row.locator('a')).toHaveCount(0);
        expect(w.asks).toHaveLength(0);
    });

    test('About: "Research X.Y.Z • What\'s new ↗", the link asked once and then kept', async ({ page }) => {
        const { b, w } = await linked(page, { seen: NEW });
        await reload(page);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('strom-research-whats-new'))).toContain(NEW);

        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        const row = page.locator('#about-modal .about-research');
        await expect(row.locator('.about-research-version')).toHaveText(`Research ${NEW}`);
        const link = row.getByRole('link', { name: 'What\'s new ↗' });
        await expect(link).toHaveAttribute('href', URL);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(w.asks).toHaveLength(1);

        // The bridge not running: the last known version and its link.
        b.down = true;
        await reload(page);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        await expect(row.locator('.about-research-version')).toHaveText(`Research ${NEW}`);
        await expect(row.getByRole('link', { name: 'What\'s new ↗' })).toHaveAttribute('href', URL);
        expect(w.asks).toHaveLength(1);
    });

    test('no research known on this computer: About has no research line', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        await expect(page.locator('#about-modal')).toBeVisible();
        await expect(page.locator('#about-modal .about-research')).toHaveCount(0);
    });
});

test.describe('Strom Research in "What\'s new" (phone)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a phone asks nothing and shows nothing of the research', async ({ page }) => {
        const { w } = await linked(page, { seen: SEEN });
        await setKey(page, 'strom-research-whats-new', JSON.stringify({ version: NEW, url: URL }));
        await reload(page);
        await page.waitForTimeout(PAST_FIRST_CHECK_MS);
        await expect(dialog(page)).toHaveCount(0);
        expect(w.asks).toHaveLength(0);
        expect(await getKey(page, SEEN_KEY)).toBe(SEEN);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        await expect(page.locator('#about-modal')).toBeVisible();
        await expect(page.locator('#about-modal .about-research')).toHaveCount(0);
    });
});
