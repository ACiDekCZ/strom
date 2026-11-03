import { test, expect, Page } from '@playwright/test';
import {
    ago, CAPS, directionRow, directionWrites, followManaged, GED, launchedLinks, ManagedBridge, MANAGED_AGENT, MANAGED_DIRECTIONS,
    openOverview, overview,
} from './live-directions-bridge.js';

/**
 * Research directions on every screen (spec 038 §6, §8.2): a computer's
 * wide window (drag, Alt+↑), the 400 px overlay, a tablet by touch (▲▼ and
 * ⋯ 40 px, the handle always), a narrow window with the bridge (the sheet:
 * ▲▼ 44 px, a tap unfolds the row with Pause / Edit / Show in tree /
 * More…, the form as a full page), the app on a phone without the bridge
 * (read only, one sentence, a tap shows the direction in the tree), a
 * phone held sideways (one-line rows, no summary, the form full height),
 * 360 px and the de / pl lengths with nothing wider than the screen, the
 * dark theme's contrast and the order said in words. Invented data only
 * (the Fíškovi of Smrkov, the Lhotákovi of Lhota).
 */

const GED_WIDE = GED.replace('0 @F0001@ FAM', [
    '0 @P0031@ INDI', '1 NAME Alois /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1868', '1 REFN P0031',
    '0 @P0060@ INDI', '1 NAME Bohuslava Terezie /Lhotáková-Šťovíčková/', '1 SEX F', '1 BIRT', '2 DATE 1812', '1 REFN P0060',
    '0 @F0001@ FAM',
].join('\n'));

const OFF_CAPS = { ...CAPS, offLineBranches: true };
const FEATURES = ['directions.edit', 'directions.order', 'directions.found', 'directions.people', 'offLine.branches', 'queue.own'];

/** The order of work with a long name (~30 characters) and a long person. */
const DIRECTIONS: Record<string, unknown>[] = [
    MANAGED_DIRECTIONS[0],
    { id: 'G0006', name: 'Předci: Bohuslava Lhotáková-Šť.', state: 'active', direction: 'ancestors', focus: 'P0060', order: 2, tasks: 12, waiting: 3,
        working: false, since: ago(4000), limits: { generations: 12, before: 1650 }, last: { at: ago(3000), text: 'sčítání lidu 1857 v Lhotě u Smrkova' } },
    MANAGED_DIRECTIONS[1],
    MANAGED_DIRECTIONS[2],
    MANAGED_DIRECTIONS[3],
];

const BRANCHES = [
    { id: 'B-P0031', person: 'P0031', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0001', tasks: 14, persons: 6,
        samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }, { id: 'T0413', text: 'Křest Terezie Fíškové' }],
        mode: 'occasional', own: false, grows: true },
];
const OFF_LINE = { mode: 'occasional', own: false, share: 10, suggest: true, tasks: 14, queued: 14, ownTasks: 0, branches: BRANCHES };
const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001', why: { kind: 'line', research: 'G0001' } },
    { id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', branch: 'B-P0031', why: { kind: 'off', mode: 'occasional', branch: 'B-P0031' } },
];
const GROWING = {
    id: 'W-B-P0031', kind: 'branch', branch: 'B-P0031', person: 'P0031', research: 'G0001', tasks: 14, persons: 6,
    at: ago(30), what: 'Větev Alois Fíšek roste', on: 'user',
};

const follow = (page: Page, size: { width: number; height: number }, more: { fastReconnect?: boolean; offLine?: boolean } = {}): Promise<ManagedBridge> =>
    followManaged(page, {
        size, researches: DIRECTIONS, working: [MANAGED_AGENT], ged: GED_WIDE, fastReconnect: more.fastReconnect,
        ...(more.offLine ? { caps: OFF_CAPS, features: FEATURES, offLine: OFF_LINE, queue: QUEUE, waiting: [GROWING] } : {}),
    });

const section = (page: Page) => overview(page).locator('.research-directions--managed');
const names = (page: Page) => section(page).locator('.research-direction--managed .research-direction__name');
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

/** The phone strip opens the sheet; a wider window its ⤢. */
async function openSheet(page: Page): Promise<void> {
    await page.locator('#live-panel .live-panel-toggle').click();
    await expect(overview(page)).toHaveClass(/research-overview--sheet/);
}

/** Nothing in the overview reaches past the window's right edge, nothing scrolls sideways. */
async function noSideways(page: Page, what: string): Promise<void> {
    const out = await page.evaluate(() => {
        const ov = document.getElementById('research-overview')!;
        const w = window.innerWidth;
        // A strip that scrolls on its own (the filter chips) may hold more than it shows.
        const inScroller = (e: HTMLElement): boolean => {
            for (let p = e.parentElement; p && p !== ov; p = p.parentElement) {
                if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= w + 1) return true;
            }
            return false;
        };
        const wide = [...ov.querySelectorAll<HTMLElement>('*')].filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.right > w + 1 && getComputedStyle(e).position !== 'fixed' && !inScroller(e);
        }).map(e => `${e.className || e.tagName}:${Math.round(e.getBoundingClientRect().right)}`);
        const body = ov.querySelector<HTMLElement>('.research-overview__body')!;
        return { wide: wide.slice(0, 5), body: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth - w };
    });
    expect(out.wide, what).toEqual([]);
    expect(out.body, what).toBeLessThanOrEqual(1);
    expect(out.doc, what).toBeLessThanOrEqual(1);
}

/** The relative luminance contrast of an element's text against the overview's background. */
function contrastOf(page: Page, sel: string): Promise<number> {
    return page.evaluate((s) => {
        const lum = (c: string): number => {
            const m = c.match(/[\d.]+/g)!.map(Number);
            const [r, g, b] = m.slice(0, 3).map(v => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const e = document.querySelector<HTMLElement>(`#research-overview ${s}`)!;
        const bg = getComputedStyle(document.getElementById('research-overview')!).backgroundColor;
        const a = lum(getComputedStyle(e).color);
        const b = lum(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, sel);
}

test.describe('directions on every screen', () => {
    test('1440: docked, a drag puts a row elsewhere and Alt+↑ moves it, each written once; ▲▼ only on touch', async ({ page }) => {
        const b = await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        await expect(overview(page)).toHaveClass(/research-overview--docked/);
        await expect(section(page).locator('.research-direction__moves').first()).toBeHidden();
        await expect(directionRow(page, 'G0002').locator('.research-direction__more')).toBeVisible();
        await directionRow(page, 'G0002').dragTo(directionRow(page, 'G0001'), { targetPosition: { x: 40, y: 3 } });
        await expect(names(page)).toHaveText(['Potomci: Josef Fíšek', 'Předci: Jan Fíšek', 'Předci: Bohuslava Lhotáková-Šť.', 'Předci: Anna Svobodová']);
        await expect.poll(() => directionWrites(b).length).toBe(1);
        expect(directionWrites(b)[0]).toMatchObject({ path: 'directions/order', body: { order: ['G0002', 'G0001', 'G0006', 'G0004'] } });
        const handle = directionRow(page, 'G0004').locator('.research-direction__handle');
        await handle.focus();
        await page.keyboard.press('Alt+ArrowUp');
        await expect(directionRow(page, 'G0004').locator('.research-direction__handle')).toBeFocused();
        await expect(page.locator('#research-directions-live')).toHaveText('Předci: Anna Svobodová, 3 of 4');
        await expect.poll(() => directionWrites(b).length).toBe(2);
        expect(directionWrites(b)[1]).toMatchObject({ body: { order: ['G0002', 'G0001', 'G0004', 'G0006'] } });
    });

    test('1100: the 400 px overlay, the handle on hover, ⋯ 28 px, no ▲▼', async ({ page }) => {
        await follow(page, { width: 1100, height: 800 });
        await openOverview(page);
        await expect(overview(page)).toHaveClass(/research-overview--overlay/);
        expect(Math.round((await box(page, '#research-overview')).width)).toBe(400);
        const row = directionRow(page, 'G0002');
        const handle = row.locator('.research-direction__handle');
        await expect(handle).toHaveCSS('opacity', '0');
        await row.hover();
        await expect(handle).toHaveCSS('opacity', '1');
        expect(Math.round((await row.locator('.research-direction__more').boundingBox())!.width)).toBe(28);
        await expect(row.locator('.research-direction__moves')).toBeHidden();
        await noSideways(page, '1100');
    });

    test.describe('by touch', () => {
        test.use({ hasTouch: true });

        test('820 tablet: the handle always, ▲▼ and ⋯ 40 px, a tap on ▲ moves and the order is said in words', async ({ page }) => {
            const b = await follow(page, { width: 820, height: 1180 });
            await openOverview(page);
            await expect(overview(page)).toHaveClass(/research-overview--overlay/);
            const row = directionRow(page, 'G0004');
            await expect(row.locator('.research-direction__handle')).toHaveCSS('opacity', '1');
            const up = row.locator('[data-move="up"]');
            const more = (await row.locator('.research-direction__more').boundingBox())!;
            const upBox = (await up.boundingBox())!;
            expect([Math.round(upBox.width), Math.round(upBox.height), Math.round(more.width), Math.round(more.height)]).toEqual([40, 40, 40, 40]);
            await expect(up).toHaveAttribute('aria-label', 'Move up: Předci: Anna Svobodová');
            // The first row's ▲ is not available.
            await expect(directionRow(page, 'G0001').locator('[data-move="up"]')).toBeDisabled();
            await up.tap();
            await expect(names(page)).toHaveText(['Předci: Jan Fíšek', 'Předci: Anna Svobodová', 'Předci: Bohuslava Lhotáková-Šť.', 'Potomci: Josef Fíšek']);
            await expect(page.locator('#research-directions-live')).toHaveText('Předci: Anna Svobodová, 2 of 4');
            await expect.poll(() => directionWrites(b).length).toBe(1);
            await noSideways(page, '820');
        });

        test('390 the app on a phone without the bridge: read only, one sentence, a tap shows the direction in the tree', async ({ page }) => {
            const b = await follow(page, { width: 390, height: 844 }, { fastReconnect: true, offLine: true });
            await openSheet(page);
            await expect(section(page).locator('.research-direction__moves').first()).toBeVisible();
            b.down = true;
            await expect(section(page).locator('.research-directions__note').first())
                .toHaveText('Directions can be changed in Strom on the computer where the research runs.', { timeout: 10000 });
            await expect(section(page).locator('.research-directions__note.is-warn')).toHaveCount(0);
            await expect(names(page)).toHaveCount(4);
            await expect(section(page).locator('.research-direction__moves, .research-direction__more, .research-direction__handle')).toHaveCount(0);
            await expect(overview(page).locator('.research-directions__new')).toHaveCount(0);
            await expect(section(page).locator('.research-direction__head[aria-expanded]')).toHaveCount(0);
            // The growing branch: no answers, where it is answered.
            const item = overview(page).locator('.research-overview__waiting-item[data-id="W-B-P0031"]');
            await item.locator('.research-overview__waiting-row').click();
            await expect(item.locator('.research-offline__wait-actions button')).toHaveCount(0);
            await expect(item.locator('.research-offline__elsewhere')).toHaveText('It can be answered in Strom on the computer or in the terminal.');
            // The branches: shown, no choices.
            await expect(section(page).locator('.research-offline__more')).toHaveCount(0);
            await noSideways(page, '390 phone');
            await directionRow(page, 'G0002').locator('.research-direction__head').tap();
            await expect(overview(page)).toHaveCount(0);
            await expect(page.locator('#evidence-pill')).toBeVisible();
            expect(directionWrites(b)).toEqual([]);
        });

        test('844×390 held sideways: the sheet without the summary, one-line rows, ▲▼ side by side, the form full height', async ({ page }) => {
            await follow(page, { width: 844, height: 390 });
            await openOverview(page);
            await expect(overview(page)).toHaveClass(/research-overview--sheet/);
            await expect(overview(page).locator('.research-overview__summary')).toBeHidden();
            const row = directionRow(page, 'G0006');
            await expect(row.locator('.research-direction__name')).toHaveCSS('white-space', 'nowrap');
            await expect(row.locator('.research-direction__meta')).toHaveCSS('white-space', 'nowrap');
            const up = (await row.locator('[data-move="up"]').boundingBox())!;
            const down = (await row.locator('[data-move="down"]').boundingBox())!;
            expect(Math.round(up.y)).toBe(Math.round(down.y));
            expect(down.x).toBeGreaterThan(up.x);
            // One line of text beside 44 px arrows.
            expect((await row.boundingBox())!.height).toBeLessThanOrEqual(56);
            await noSideways(page, '844×390');
            await overview(page).locator('.research-directions__new').click();
            const form = page.locator('#direction-form-modal .modal');
            await expect(form).toBeVisible();
            const f = (await form.boundingBox())!;
            expect(Math.round(f.y)).toBe(0);
            expect(Math.round(f.height)).toBe(390);
            // Its body scrolls (the fields are taller than the window).
            const scrolls = await form.evaluate(m => [m, ...m.querySelectorAll<HTMLElement>('*')].some(e => e.scrollHeight > e.clientHeight + 4
                && /(auto|scroll)/.test(getComputedStyle(e).overflowY)));
            expect(scrolls).toBe(true);
        });
    });

    test('390 a narrow window with the bridge: ▲▼ 44 px, a tap unfolds Pause / Edit / Show in tree / More…, the form a full page', async ({ page }) => {
        const b = await follow(page, { width: 390, height: 844 });
        await openSheet(page);
        const row = directionRow(page, 'G0006');
        await expect(row.locator('.research-direction__handle, .research-direction__more')).toHaveCount(0);
        const up = (await row.locator('[data-move="up"]').boundingBox())!;
        expect([Math.round(up.width), Math.round(up.height)]).toEqual([44, 44]);
        const add = overview(page).locator('.research-directions__new');
        await expect(add).toBeVisible();
        expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        const head = row.locator('.research-direction__head');
        await expect(head).toHaveAttribute('aria-expanded', 'false');
        await head.click();
        await expect(row.locator('.research-direction__head')).toHaveAttribute('aria-expanded', 'true');
        const acts = row.locator('.research-direction__actions > button');
        await expect(acts).toHaveText(['Pause', 'Edit', 'Show in tree', 'More…']);
        for (const h of await acts.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
        // Through the bridge: no mark.
        await expect(row.locator('.research-direction__actions .research-open-mark')).toHaveCount(0);
        await noSideways(page, '390 unfolded');

        // More…: End…, Move to the top, Work on it (its agent in the terminal), above the sheet.
        await row.locator('[data-do="more"]').click();
        const menu = page.locator('#live-direction-menu');
        await expect(menu).toHaveAttribute('role', 'menu');
        await expect(menu.locator('[role="menuitem"]')).toHaveCount(3);
        await expect(menu.locator('[data-do]')).toHaveText([/^End…/, 'Move to the top', /Work on this direction/]);
        await expect(menu.locator('[data-do="work"] .research-ai-badge')).toHaveCount(1);
        await expect(menu.locator('[data-do="work"] .research-open-mark')).toHaveCount(1);
        await page.keyboard.press('ArrowDown');
        await expect(menu.locator('[data-do="top"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(row.locator('[data-do="more"]')).toBeFocused();
        await row.locator('[data-do="more"]').click();
        await menu.locator('[data-do="top"]').click();
        await expect(names(page).first()).toHaveText('Předci: Bohuslava Lhotáková-Šť.');
        await expect.poll(() => directionWrites(b).length).toBe(1);
        expect(directionWrites(b)[0]).toMatchObject({ path: 'directions/order', body: { order: ['G0006', 'G0001', 'G0004', 'G0002'] } });
        await directionRow(page, 'G0006').locator('[data-do="more"]').click();
        await menu.locator('[data-do="work"]').click();
        await expect.poll(() => launchedLinks(page)).toHaveLength(1);

        // End… asks in a bottom sheet; Cancel goes back to More….
        await directionRow(page, 'G0006').locator('[data-do="more"]').click();
        await menu.locator('[data-do="done"]').click();
        const end = page.locator('#research-direction-end');
        await expect(end).toHaveClass(/is-sheet/);
        await end.getByRole('button', { name: 'Cancel' }).click();
        await expect(end).toHaveCount(0);
        await expect(directionRow(page, 'G0006').locator('[data-do="more"]')).toBeFocused();

        // Pause: written, the toast with Undo above the sheet.
        await directionRow(page, 'G0006').locator('[data-do="pause"]').click();
        await expect.poll(() => directionWrites(b).length).toBe(2);
        const toast = page.locator('.toast[data-kind="direction"]');
        await expect(toast).toBeVisible();
        const onTop = await toast.evaluate(t => {
            const r = t.getBoundingClientRect();
            return t.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        expect(onTop).toBe(true);

        // Edit: the form over the sheet, a full page.
        await directionRow(page, 'G0006').locator('[data-do="edit"]').click();
        const form = page.locator('#direction-form-modal .modal');
        await expect(form).toBeVisible();
        const f = (await form.boundingBox())!;
        expect([Math.round(f.x), Math.round(f.y), Math.round(f.width), Math.round(f.height)]).toEqual([0, 0, 390, 844]);
    });

    test('360 and the de / pl lengths: names wrap, nothing wider than the screen (panel, branches, queue, Awaiting, settings)', async ({ page }) => {
        await follow(page, { width: 360, height: 780 }, { offLine: true });
        for (const lang of ['en', 'de', 'pl']) {
            await page.evaluate((l) => window.Strom.UI.setLanguage(l as never), lang);
            if (await overview(page).count() === 0) await openSheet(page);
            await page.evaluate(() => window.Strom.UI.renderResearchOverview());
            const row = directionRow(page, 'G0006');
            const head = row.locator('.research-direction__head');
            if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
            await expect(row.locator('.research-direction__detail')).toBeVisible();
            await expect(row.locator('.research-direction__name')).not.toHaveCSS('white-space', 'nowrap');
            const toggle = section(page).locator('.research-offline__toggle');
            if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
            const branch = section(page).locator('.research-offline__branch[data-branch="B-P0031"]');
            if (await branch.locator('.research-offline__choices').count() === 0) await branch.locator('.research-offline__expand').click();
            await expect(branch.locator('.research-offline__segment')).toBeVisible();
            const item = overview(page).locator('.research-overview__waiting-item[data-id="W-B-P0031"]');
            if (await item.locator('.research-offline__wait-actions').count() === 0) await item.locator('.research-overview__waiting-row').click();
            await expect(item.locator('.research-offline__wait-actions')).toBeVisible();
            const queue = overview(page).locator('.live-queue-toggle');
            if (await queue.count() > 0 && await queue.getAttribute('aria-expanded') !== 'true') await queue.click();
            await noSideways(page, `360 ${lang}`);
        }
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        const modal = page.locator('#research-tree-settings-modal .modal');
        await expect(modal.locator('.research-offline-settings')).toBeVisible();
        expect(await modal.evaluate(m => m.scrollWidth - m.clientWidth)).toBeLessThanOrEqual(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    });

    test('the dark theme: the rows, notes and numbers keep a 4.5 : 1 contrast, docked and in the sheet', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await openOverview(page);
        const sels = [
            '.research-direction--managed .research-direction__name',
            '.research-direction--managed.is-paused .research-direction__name',
            '.research-direction--managed .research-direction__meta',
            '.research-direction__num',
            '.research-directions__note',
            '.research-directions__new',
        ];
        for (const sel of sels) expect(await contrastOf(page, sel), `dark docked ${sel}`).toBeGreaterThanOrEqual(4.5);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => window.Strom.UI.renderResearchOverview());
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        for (const sel of sels) expect(await contrastOf(page, sel), `dark sheet ${sel}`).toBeGreaterThanOrEqual(4.5);
        await noSideways(page, 'dark 390');
    });
});
