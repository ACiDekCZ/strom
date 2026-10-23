import { test, expect, Page } from '@playwright/test';

/**
 * Sources in the research's history (spec 015, 3a–3d): a line naming a
 * source (`/log` `sources`) links its title to the source's viewer, over the
 * live panel or the overview (a phone's sheet stays under it), only to read,
 * following not paused, the focus back on the link; a source the loaded
 * version does not have yet says so under a newer line, an older line (the
 * source taken back) stays text, a line without sources (an older research)
 * is as before. Invented data only.
 */

const UUID = '3b9d2f41-6c0e-4a7b-9e15-0d8c7a6b5f42';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const TITLE = 'Oddací matrika Kolín 1900–1905';

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Novákovi',
    '0 @P0012@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 BIRT', '2 DATE 1870', '1 REFN P0012', '1 FAMS @F0002@',
    '0 @P0013@ INDI', '1 NAME Marie /Nováková/', '1 SEX F', '1 REFN P0013', '1 FAMS @F0002@',
    '0 @F0002@ FAM', '1 HUSB @P0012@', '1 WIFE @P0013@', '1 MARR', '2 DATE 1903', '2 SOUR @S0040@',
    '0 @S0040@ SOUR', `1 TITL ${TITLE}`, '1 REFN S0040',
    '0 TRLR',
].join('\n');

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();
const TASK = 'Sňatek 1903';

async function follow(page: Page, size = { width: 1440, height: 900 }): Promise<void> {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
        class FakeEventSource {
            url: string;
            readyState = 1;
            onerror: ((e: Event) => void) | null = null;
            private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
            constructor(url: string) {
                this.url = url;
                void fetch(url.replace(/\/events(\?.*)?$/, '/status')).then(r => r.json()).then(st => this.emit('hello', st));
            }
            addEventListener(type: string, fn: (e: MessageEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
            removeEventListener(): void { /* not needed */ }
            close(): void { this.readyState = 2; }
            emit(type: string, data: unknown): void {
                for (const fn of this.listeners[type] ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
            }
        }
        Object.defineProperty(window, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });
    });
    const status = {
        tree: { id: UUID, name: 'Novákovi' }, head: 'h3', persons: 2,
        working: [{ who: 'agent-zapis', since: ago(10), task: TASK, person: 'P0013', session: 'N0133' }],
        waiting: [], queue: [],
    };
    const log = { entries: [
        // Newer than the version the app has (h3): its source is not in the tree yet.
        { head: 'h4', at: ago(1), what: ['+S0050 Sčítání'], text: ['Nový pramen: Sčítání lidu 1910 Kolín'], sources: [['S0050']], task: TASK },
        { head: 'h3', at: ago(2), what: ['S0040 TEXT'], text: [`Přepis pramene: ${TITLE} (2 snímky)`], sources: [['S0040']], task: TASK },
        // Older: a source since taken back — text only, no hint.
        { head: 'h2', at: ago(4), what: ['S0031 x'], text: ['Pramen: Kniha zemřelých 1890'], sources: [['S0031']], task: TASK },
        // An older research: no sources.
        { head: 'h1', at: ago(6), what: ['P0012 +BIRT'], text: ['Zapsáno: narození Jana Nováka [P0012]'], task: TASK },
    ] };
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (path.endsWith('/status')) return json(status);
        if (path.endsWith('/log')) return json(log);
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => Object.keys(window.Strom.DataManager.getData().sources ?? {}).length)).toBe(1);
}

const viewer = (page: Page) => page.locator('#source-viewer-modal');

/**
 * Open the overview once the following is ready for it: under load the
 * sources can be in the data before the live session takes the tree, and an
 * open asked that early does nothing. Asked again on the next round, never
 * waited on once.
 */
async function openOverview(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => {
        if (!window.Strom.UI.isResearchOverviewOpen()) window.Strom.UI.openResearchOverview();
        return window.Strom.UI.isResearchOverviewOpen();
    })).toBe(true);
}

test.describe('sources in the research history', () => {
    test('the overview links a source to its viewer, read only, following goes on, focus back; newer, taken back, without sources', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const ov = page.locator('#research-overview');
        const rows = ov.locator('.research-overview__row');
        await expect(rows).toHaveCount(4);
        // The newest line: its source is in a newer version (nothing waits here: the sentence only).
        await expect(rows.nth(0).locator('.live-hint')).toHaveText('The source is in a newer research version.');
        await expect(rows.nth(0).locator('.live-source-link')).toHaveCount(0);
        await expect(rows.nth(0).locator('.live-hint button')).toHaveCount(0);
        // The loaded source: its title a link.
        const link = rows.nth(1).locator('.live-source-link');
        await expect(link).toHaveText(TITLE);
        await expect(rows.nth(1).locator('.research-overview__row-text')).toHaveText(`Přepis pramene: ${TITLE} (2 snímky)`);
        // Taken back (an older line), and an older research's line: text, no hint.
        await expect(rows.nth(2).locator('.live-source-link, .live-hint')).toHaveCount(0);
        await expect(rows.nth(3).locator('.live-source-link, .live-hint')).toHaveCount(0);

        await link.click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(page.locator('#source-viewer-title')).toHaveText(TITLE);
        await expect(page.locator('#source-viewer-edit')).toBeHidden();
        await expect(page.locator('#source-viewer-same-book')).toBeHidden();
        // The overview stays, following is not paused.
        await expect(ov).toBeVisible();
        await expect(page.locator('#live-follow-pill')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(ov).toBeVisible();
        await expect(link).toBeFocused();
    });

    test('the live panel links the source too; its hint has no load button', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        const head = panel.locator('[aria-controls="live-sec-changes"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        await expect(panel.locator('.live-changes .live-source-link')).toHaveText([TITLE]);
        await expect(panel.locator('.live-changes .live-hint')).toHaveText(['The source is in a newer research version.']);
        await expect(panel.locator('.live-changes .live-hint button')).toHaveCount(0);
        await panel.locator('.live-source-link').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await viewer(page).locator('.close-btn').first().click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(panel.locator('.live-source-link')).toBeFocused();
    });

    test('phone: the viewer opens above the overview sheet, which stays under it', async ({ page }) => {
        await follow(page, { width: 390, height: 844 });
        await openOverview(page);
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        await ov.locator('.live-source-link').click();
        await expect(viewer(page)).toHaveClass(/is-over-sheet/);
        // On top: its close button takes the click (a covered one would not).
        await viewer(page).locator('.close-btn').first().click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(ov).toBeVisible();
        await expect(ov.locator('.live-source-link')).toBeFocused();
    });
});

/**
 * The overview's head and the history's links in the narrow forms (de, the
 * widest title): in the 400px overlay (1024) and the phone's sheet the title
 * stays whole, Stop sits on the line under it beside the research's name (the
 * name is seen, never squeezed to nothing), and a source's title in a line
 * starts at the line's left like a link in the text, never centred.
 */
test.describe('the overview head and the history links, narrow (de-DE)', () => {
    test.use({ locale: 'de-DE' });

    const head = (page: Page) => page.evaluate(() => {
        const box = (s: string) => document.querySelector(`#research-overview ${s}`)!.getBoundingClientRect();
        const title = document.querySelector<HTMLElement>('#research-overview .research-overview__title')!;
        const titles = document.querySelector<HTMLElement>('#research-overview .research-overview__titles')!;
        const t = box('.research-overview__title'), stop = box('.live-panel-action'), name = box('.research-overview__name');
        const overlap = Math.min(t.right, stop.right) - Math.max(t.left, stop.left) > 0 && Math.min(t.bottom, stop.bottom) - Math.max(t.top, stop.top) > 0;
        return {
            titleWhole: title.scrollWidth <= title.clientWidth + 1,
            titlesFit: titles.scrollWidth <= titles.clientWidth + 1,
            stopClearOfTitle: !overlap,
            nameShown: name.width > 20,
        };
    });

    for (const size of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
        test(`${size.width}px: the title whole, Stop under it, the name seen`, async ({ page }) => {
            await follow(page, size);
            await openOverview(page);
            await expect(page.locator('#research-overview .research-overview__title')).toHaveText('Forschungsübersicht');
            expect(await head(page)).toEqual({ titleWhole: true, titlesFit: true, stopClearOfTitle: true, nameShown: true });
        });
    }

    test('a source title in a history line starts at the left, not centred', async ({ page }) => {
        await follow(page, { width: 1024, height: 768 });
        await openOverview(page);
        const link = page.locator('#research-overview .live-source-link').first();
        await expect(link).toHaveText(TITLE);
        expect(await link.evaluate(el => getComputedStyle(el).textAlign)).toBe('start');
    });
});
