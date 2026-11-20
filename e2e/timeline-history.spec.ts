import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll, HISTORY_R1_FEATURES, FakeHistory,
} from './research-bridge.js';
import { openApp } from './helpers.js';

/**
 * The Timeline view's history row (spec 121 §1, after DEV symboly-dejin §9):
 * one row "History ▾" under the axis band for the WHOLE timeline — every event
 * of a region where a person with a row lived in its year — the focused
 * person's life a thin line in it, each cluster the kind most of its events
 * have with a count; a click opens a popover of its events with links to the
 * cards of whom each concerns (§2), a phone shows a sheet with the persons.
 * Nothing without a research. Invented data: Jan lived in Čapkov 1860–1910,
 * Josef 1830–1869, Anna has no years.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

/** fakeHistoryR1 + an epidemic in 1866 (a year of two). */
function timelineHistory(): FakeHistory {
    const h = fakeHistoryR1();
    const bohemia = { id: 'cz-bohemia', name: { cs: 'Čechy', en: 'Bohemia', de: 'Böhmen' } };
    (h.payload.events as Record<string, unknown>[]).push(
        { id: 'E6', from: 1866, kind: 'epidemic', scope: 'region', region: bohemia,
            text: { cs: 'Cholera po válce.', en: 'Cholera after the war.', de: 'Cholera nach dem Krieg.' },
            source: { title: 'Invented chronicle', url: 'https://example.org/cholera-1866', checked: '2026-10-01' } },
    );
    const place = h.payload.places['Čapkov'] as Record<string, unknown>;
    place.events = [...(place.events as string[]), 'E6'];
    return h;
}

/** The history tree with Josef born in Čapkov in 1830, died there in 1869 (his years see only 1866–1867). */
function timelineGed(): string {
    return historyGed().replace('1 NAME Josef /Fíšek/', '1 NAME Josef /Fíšek/\n1 BIRT\n2 DATE 1830\n2 PLAC Čapkov\n1 DEAT\n2 DATE 1869\n2 PLAC Čapkov');
}

/**
 * Four more invented children of Josef and Anna, all in Čapkov through 1866
 * (six persons concern its cluster), the first with a long name.
 */
const CROWD = [
    ['P0004', 'Bartholomäus /Quellmayer-Ostrovidský/', '1850'],
    ['P0005', 'Jonáš /Quellmayer/', '1852'],
    ['P0006', 'Ilsa /Quellmayerová/', '1854'],
    ['P0007', 'Eliáš /Quellmayer/', '1856'],
];
function crowdGed(): string {
    const indi = CROWD.map(([id, name, born]) => [`0 @${id}@ INDI`, `1 NAME ${name}`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', `2 DATE ${born}`, '2 PLAC Čapkov', '1 DEAT', '2 DATE 1900', '2 PLAC Čapkov', '1 FAMC @F0001@'].join('\n')).join('\n');
    return timelineGed()
        .replace('0 @F0001@ FAM', `${indi}\n0 @F0001@ FAM`)
        .replace('1 CHIL @P0003@', ['1 CHIL @P0003@', ...CROWD.map(([id]) => `1 CHIL @${id}@`)].join('\n'));
}

async function setup(page: Page, opts: { width?: number; height?: number; crowd?: boolean; ged?: string; edit?: (h: FakeHistory) => void } = {}): Promise<void> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = timelineHistory();
    opts.edit?.(history);
    const ged = opts.ged ?? (opts.crowd ? crowdGed() : timelineGed());
    await fakeBridge(page, { features: HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
}

async function focusOn(page: Page, first: string): Promise<void> {
    await page.evaluate(async (first) => {
        const p = (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(x => x.firstName === first)!;
        await window.Strom.TreeRenderer.setFocus(p.id as never);
    }, first);
}

async function timelineView(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('timeline'));
    await expect(page.locator('#timeline-container .timeline-bar').first()).toBeVisible();
}

const histRow = (page: Page) => page.locator('#timeline-container .tl-hist-row');
const clusters = (page: Page) => histRow(page).locator('.tl-hist');

test.describe('Timeline: the history row', () => {
    test('the whole timeline, under the axis; a change of focus moves only the life line; the rows move down by it', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        await expect(histRow(page)).toHaveCount(1);
        // The label: "History ▾", the options' button (no name: the row is the whole timeline's).
        const btn = histRow(page).locator('.tl-hist-label button.tl-hist-btn');
        await expect(btn.locator('b')).toHaveText('History');
        await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        await expect(btn).toHaveAttribute('title', 'History options on the timeline');
        await expect(page.locator('#timeline-container .tl-rows')).toHaveAttribute('transform', 'translate(0 28)');
        // 1866 (war + epidemic) one cluster: one symbol, a count, both persons.
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        await expect(y1866).toHaveAttribute('aria-label', /^1866(–1867)?: war, epidemic.*; concerns 2 people$/);
        await expect(y1866).toHaveAttribute('role', 'button');
        await expect(y1866.locator('svg.hist-kind-svg')).toHaveCount(1);
        await expect(y1866.locator('svg.hist-kind-svg')).toHaveAttribute('aria-hidden', 'true');
        await expect(y1866.locator('.tl-hist-n-txt')).not.toHaveText('');
        // Two regions (Bohemia, the Austrian Empire): each event's line names its region.
        await expect(y1866.locator('title')).toContainText('1866 · war · Bohemia – ');
        // The local finding (1880 fire) is not the row's: it belongs on Jan's own line.
        const janIds = await clusters(page).evaluateAll(els => els.map(e => e.getAttribute('data-hist-ids')).join(' '));
        expect(janIds).not.toContain('E4');
        expect(janIds).toContain('E1');
        const life = histRow(page).locator('.tl-hist-life');
        await expect(life).toHaveCount(1);
        const janLife = await life.getAttribute('x');

        // Josef: the same events, the line of his life instead.
        await focusOn(page, 'Josef');
        await expect(life).not.toHaveAttribute('x', janLife!);
        const josefIds = await clusters(page).evaluateAll(els => els.map(e => e.getAttribute('data-hist-ids')).join(' '));
        expect(josefIds).toBe(janIds);

        // Anna has no years: the row stays (the others' events), no line of a life.
        await focusOn(page, 'Anna');
        await expect(histRow(page)).toHaveCount(1);
        await expect(life).toHaveCount(0);
        await expect(page.locator('#timeline-container .tl-rows')).toHaveAttribute('transform', 'translate(0 28)');
    });

    test("the card's History chip off: no row; on again: the row", async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        await expect(histRow(page)).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.toggleLifelineHistory(false));
        await expect(histRow(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.toggleLifelineHistory(true));
        await expect(histRow(page)).toHaveCount(1);
        // The history layer off in Settings: no row either.
        await page.evaluate(() => { window.Strom.SettingsManager.setHistoryLayer(false); window.Strom.UI.historyChanged(); });
        await expect(histRow(page)).toHaveCount(0);
    });

    test('a click on a cluster: its popover — the events, kind · region, whom each concerns; a name opens the card; Esc gives the keyboard back', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Josef');
        await timelineView(page);
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        await expect(y1866).toHaveAttribute('aria-haspopup', 'dialog');
        const ids = (await y1866.getAttribute('data-hist-ids'))!.split(' ');
        await y1866.click();
        const pop = page.locator('.tl-pop[role="dialog"]');
        await expect(pop).toHaveCount(1);
        await expect(pop.locator('.tl-pop-title')).toHaveText(/^History 1866(–1867)?$/);
        await expect(pop).toHaveAttribute('aria-label', (await pop.locator('.tl-pop-title').textContent())!);
        await expect(pop.locator('ol.tl-pop-list > li.tl-pop-ev')).toHaveCount(ids.length);
        const war = pop.locator('.tl-pop-ev').filter({ hasText: 'war · Bohemia' });
        await expect(war.locator('.tl-pop-y')).toHaveText('1866');
        await expect(war.locator('.tl-pop-sym svg.hist-kind-svg')).toHaveAttribute('width', '14');
        // The focused person first, then the rows' order.
        await expect(war.locator('.tl-pop-who')).toHaveText('Concerns: Josef Fíšek, Jan Fíšek');
        await expect(war.locator('.tl-pop-who .link-button')).toHaveText(['Josef Fíšek', 'Jan Fíšek']);
        // Under the row, not past the window's edges; no research mark on its actions.
        const box = (await pop.boundingBox())!;
        const row = (await histRow(page).locator('.tl-hist-band').boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(row.y + row.height);
        expect(box.x).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 7);
        await expect(pop.locator('.research-open-mark, .ai-badge')).toHaveCount(0);

        // Tab stays inside: ×, the names, × again.
        const inside = () => page.evaluate(() => !!document.activeElement?.closest('.tl-pop'));
        for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); expect(await inside()).toBe(true); }
        // Esc closes it; the keyboard is back on the cluster.
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(y1866).toBeFocused();
        // Enter opens it again, a second click on the cluster closes it; a click beside it closes it too.
        await page.keyboard.press('Enter');
        await expect(pop).toHaveCount(1);
        await y1866.click();
        await expect(pop).toHaveCount(0);
        await y1866.click();
        await expect(pop).toHaveCount(1);
        await page.locator('#timeline-container').click({ position: { x: 4, y: 4 } });
        await expect(pop).toHaveCount(0);

        // A name: the card on that event's row, its year unfolded; the popover closed.
        await y1866.click();
        await pop.locator('.tl-pop-ev').filter({ hasText: 'war · Bohemia' }).getByRole('button', { name: 'Jan Fíšek' }).click();
        await expect(pop).toHaveCount(0);
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#input-firstname')).toHaveValue('Jan');
        await expect(page.locator('#pm-lifeline-body .k-historyGroup[data-history-year="1866"]')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-history[data-history-id="E1"]')).toBeVisible();
    });

    test('the popover in German with a long name and six persons: two names, "und 4 weitere", wrapped, nothing overflows', async ({ page }) => {
        await setup(page, { width: 1024, height: 768, crowd: true });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Bartholomäus');
        await timelineView(page);
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        await expect(y1866).toHaveAttribute('aria-label', /betrifft 6 Personen$/);
        await y1866.click();
        const pop = page.locator('.tl-pop');
        await expect(pop.locator('.tl-pop-title')).toHaveText(/^Geschichte 1866/);
        const war = pop.locator('.tl-pop-ev').filter({ hasText: 'Krieg · Böhmen' });
        await expect(war.locator('.tl-pop-who')).toHaveText('Betrifft: Bartholomäus Quellmayer-Ostrovidský, Josef Fíšek und 4 weitere');
        const over = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth - window.innerWidth,
            pop: [...document.querySelectorAll<HTMLElement>('.tl-pop, .tl-pop *')]
                .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible').map(el => el.className),
            outside: [...document.querySelectorAll<HTMLElement>('.tl-pop *')].filter(el => {
                const r = el.getBoundingClientRect(), p = el.closest('.tl-pop')!.getBoundingClientRect();
                return r.width > 0 && (r.left < p.left - 0.5 || r.right > p.right + 0.5);
            }).map(el => el.className),
        }));
        expect(over).toEqual({ page: 0, pop: [], outside: [] });
        // The long name wraps inside the popover (two lines at most at 380 px), its box within the popover.
        const name = war.getByRole('button', { name: 'Bartholomäus Quellmayer-Ostrovidský' });
        const nb = (await name.boundingBox())!, pb = (await pop.boundingBox())!;
        expect(nb.x + nb.width).toBeLessThanOrEqual(pb.x + pb.width);
    });

    test('phone 390: a sheet without a name — the events with kind · region, then the persons to open; a tap opens the card', async ({ page }) => {
        await setup(page, { width: 390, height: 844 });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Jan');
        await timelineView(page);
        await expect(histRow(page).locator('.tl-hist-btn b')).toHaveText('Geschichte');
        await expect(page.locator('#timeline-container .tl-rows')).toHaveAttribute('transform', 'translate(0 26)');
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        const ids = (await y1866.getAttribute('data-hist-ids'))!.split(' ');
        await y1866.click();
        await expect(page.locator('.tl-pop')).toHaveCount(0);
        const sheet = page.locator('.bottom-sheet.tl-hsheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tl-hsheet-title')).toHaveText(/^Geschichte 1866(–1867)?$/);
        await expect(sheet.locator('.tl-hsheet-row')).toHaveCount(ids.length);
        await expect(sheet.locator('.tl-hsheet-row svg.hist-kind-svg')).toHaveCount(ids.length);
        await expect(sheet.locator('.tl-hsheet-row .tl-hsheet-meta').getByText('Krieg · Böhmen', { exact: true })).toHaveCount(1);
        await expect(sheet.locator('.tl-hsheet-sub')).toHaveText('In der Personenkarte öffnen');
        // The focused person first, then the rows' order.
        await expect(sheet.locator('.tl-hsheet-person > span:first-child')).toHaveText(['Jan Fíšek', 'Josef Fíšek']);
        await expect(sheet.locator('.tl-hsheet-more')).toHaveCount(0);
        const over = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll('.tl-hsheet, .tl-hsheet *, #timeline-container')]
            .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' || el === document.documentElement && el.scrollWidth > el.clientWidth)
            .map(el => (el as HTMLElement).className || el.tagName));
        expect(over).toEqual([]);
        // Closing: the Close button.
        await sheet.locator('.pm-lifeline-hsheet-cancel').click();
        await expect(sheet).toHaveCount(0);
        // Again, then Josef: his card on the cluster's first event that concerns him.
        await y1866.click();
        await sheet.locator('.tl-hsheet-person').filter({ hasText: 'Josef Fíšek' }).click();
        await expect(page.locator('.bottom-sheet.tl-hsheet')).toHaveCount(0);
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#input-firstname')).toHaveValue('Josef');
        await expect(page.locator(`#pm-lifeline-body [data-history-id="${decodeURIComponent(ids[0])}"]`).first()).toBeAttached();
    });

    test('phone 390, six persons: four rows and "und 2 weitere ›" unfolds the rest in the sheet; the long name wraps', async ({ page }) => {
        await setup(page, { width: 390, height: 844, crowd: true });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Jan');
        await timelineView(page);
        await clusters(page).and(page.locator('[aria-label^="1866"]')).click();
        const sheet = page.locator('.bottom-sheet.tl-hsheet');
        const persons = sheet.locator('.tl-hsheet-person');
        await expect(persons).toHaveCount(4);
        await expect(persons.first()).toHaveText(/Jan Fíšek/);
        const more = sheet.locator('.tl-hsheet-more');
        await expect(more).toHaveText('und 2 weitere ›');
        await more.click();
        await expect(more).toHaveCount(0);
        await expect(persons).toHaveCount(6);
        await expect(sheet).toBeVisible();
        await expect(persons.nth(4)).toBeFocused();
        const over = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll('.tl-hsheet, .tl-hsheet *')]
            .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' || el === document.documentElement && el.scrollWidth > el.clientWidth)
            .map(el => (el as HTMLElement).className || el.tagName));
        expect(over).toEqual([]);
        const long = persons.filter({ hasText: 'Bartholomäus Quellmayer-Ostrovidský' });
        const lb = (await long.boundingBox())!;
        expect(lb.x + lb.width).toBeLessThanOrEqual(390);
    });

    test('a tree without a research: no row, no extra height', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await timelineView(page);
        await expect(page.locator('#timeline-container .tl-hist-row, #timeline-container .tl-rows')).toHaveCount(0);
    });
});

/** The row's label, the options' button. */
const histBtn = (page: Page) => histRow(page).locator('button.tl-hist-btn');
/** The ids of the row's events drawn, sorted. */
const drawnIds = (page: Page) => clusters(page).evaluateAll(els => els.flatMap(e => (e.getAttribute('data-hist-ids') ?? '').split(' ')).filter(Boolean).sort());
/** Elements of `selector` whose content overflows them (plus the page itself). */
const overflowing = (page: Page, selector: string) => page.evaluate((selector) => [document.documentElement, ...document.querySelectorAll(selector)]
    .filter(el => el === document.documentElement ? el.scrollWidth > el.clientWidth : el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
    .map(el => (el as HTMLElement).className || el.tagName), selector);

test.describe('Timeline: the history row\'s options (spec 121 §5, §10)', () => {
    test('the label opens them under it: kinds with counts, regions, the local option; a kind filters the row and stays open; Esc gives the keyboard back', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        expect(await drawnIds(page)).toEqual(['E1', 'E3', 'E6']);
        const btn = histBtn(page);
        await btn.click();
        const pop = page.locator('.tl-pop.tl-pop-opts[role="dialog"]');
        await expect(pop).toHaveCount(1);
        await expect(pop).toHaveAttribute('aria-label', 'History options on the timeline');
        await expect(pop.locator('.tl-pop-title')).toHaveText('History');
        await expect(btn).toHaveClass(/is-open/);
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        // 400 px wide, under the row, inside the window.
        const box = (await pop.boundingBox())!;
        const row = (await histRow(page).locator('.tl-hist-band').boundingBox())!;
        expect(Math.round(box.width)).toBe(400);
        expect(box.y).toBeGreaterThanOrEqual(row.y + row.height);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 7);
        // The kinds: "All" pressed, then the nine with their symbol and count; one without an event can be chosen.
        const kinds = pop.locator('.hd-chips[role="group"] > button.hd-chip');
        await expect(kinds).toHaveCount(10);
        await expect(kinds.first()).toHaveText('All');
        await expect(kinds.first()).toHaveAttribute('aria-pressed', 'true');
        const war = kinds.filter({ hasText: 'War' });
        await expect(war).toHaveAttribute('aria-pressed', 'false');
        await expect(war).toHaveAttribute('title', 'war');
        await expect(war.locator('.hd-chip-n')).toHaveText('1');
        await expect(war.locator('svg.hist-kind-svg')).toHaveAttribute('width', '12');
        await expect(kinds.filter({ hasText: 'Law' }).locator('.hd-chip-n')).toHaveText('0');
        // Two regions on the row: "All" and both, the most events first.
        const regions = pop.locator('.hd-chips[role="radiogroup"] > button.hd-chip');
        await expect(regions).toHaveText(['All', 'Bohemia 2', 'Austrian Empire 1']);
        await expect(regions.first()).toHaveAttribute('aria-checked', 'true');
        // The local option off, available (Jan's 1880 fire is on his line with it).
        const local = pop.locator('.tl-pop-check input[type="checkbox"]');
        await expect(local).not.toBeChecked();
        await expect(local).toBeEnabled();
        await expect(pop.locator('.tl-pop-check .tl-pop-hint')).toHaveText('Fires, floods and research findings in the place where the person lived that year.');
        await expect(pop.getByRole('button', { name: 'Clear filter' })).toHaveCount(0);
        await expect(pop.locator('.research-open-mark, .ai-badge')).toHaveCount(0);

        // War: the row keeps 1866's war alone, the label says so; the options stay open, the keyboard on the chip.
        await war.click();
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· 1 kind');
        await expect(histBtn(page)).toHaveClass(/is-filtered/);
        await expect(histBtn(page)).toHaveClass(/is-open/);
        expect(await drawnIds(page)).toEqual(['E1']);
        await expect(pop).toHaveCount(1);
        await expect(kinds.filter({ hasText: 'War' })).toHaveAttribute('aria-pressed', 'true');
        await expect(kinds.filter({ hasText: 'War' })).toBeFocused();
        await expect(kinds.first()).toHaveAttribute('aria-pressed', 'false');
        // The regions count within the kinds chosen.
        await expect(regions).toHaveText(['All', 'Bohemia 1']);
        await expect(pop.getByRole('button', { name: 'Clear filter' })).toHaveCount(1);
        // Stored for the tree.
        expect(await page.evaluate(() => window.Strom.SettingsManager.getTimelineHistory(window.Strom.DataManager.getCurrentTreeId()))).toEqual({ kinds: ['war'], local: false });

        // Esc closes them, the keyboard on the label.
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(histBtn(page)).toBeFocused();
        await expect(histBtn(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(histBtn(page)).not.toHaveClass(/is-open/);
        // Enter opens them again; a second click on the label closes them.
        await page.keyboard.press('Enter');
        await expect(pop).toHaveCount(1);
        await histBtn(page).click();
        await expect(pop).toHaveCount(0);
    });

    test('a filter that leaves nothing: "0 kinds", the sentence and "Clear filter" in the row; it clears kinds and region at once', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        await histBtn(page).click();
        const pop = page.locator('.tl-pop.tl-pop-opts');
        // A region, then a kind it has no event of.
        await pop.locator('.hd-chips[role="radiogroup"] > button.hd-chip').filter({ hasText: 'Austrian Empire' }).click();
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· Austrian Empire');
        expect(await drawnIds(page)).toEqual(['E3']);
        await pop.locator('.hd-chips[role="group"] > button.hd-chip').filter({ hasText: 'Law' }).click();
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· 2 filters');
        await expect(clusters(page)).toHaveCount(0);
        // The kinds alone: "0 kinds" (law has no event on the timeline).
        await pop.locator('.hd-chips[role="radiogroup"] > button.hd-chip').first().click();
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· 0 kinds');
        const empty = histRow(page).locator('.tl-hist-empty');
        await expect(empty).toContainText('No history for the chosen kinds');
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        // Region again (stored directly), then "Clear filter" in the row: both gone in one step, the local option kept.
        await page.evaluate(() => {
            const id = window.Strom.DataManager.getCurrentTreeId();
            window.Strom.SettingsManager.setTimelineHistory(id, { kinds: ['law'], region: 'at-empire', local: true });
        });
        await page.evaluate(() => window.Strom.UI.historyChanged());
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· 2 filters');
        await empty.getByRole('button', { name: 'Clear filter' }).click();
        await expect(empty).toHaveCount(0);
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveCount(0);
        expect(await drawnIds(page)).toEqual(['E1', 'E3', 'E6']);
        expect(await page.evaluate(() => window.Strom.SettingsManager.getTimelineHistory(window.Strom.DataManager.getCurrentTreeId()))).toEqual({ local: true });
        await expect(histBtn(page)).toBeFocused();
    });

    test('one region on the row: no region part; local history off in Settings: the option unavailable, saying why', async ({ page }) => {
        await setup(page, { edit: (h) => { h.payload.events = (h.payload.events as { id: string }[]).filter(e => e.id !== 'E3'); } });
        await focusOn(page, 'Jan');
        await timelineView(page);
        expect(await drawnIds(page)).toEqual(['E1', 'E6']);
        await histBtn(page).click();
        const pop = page.locator('.tl-pop.tl-pop-opts');
        await expect(pop.locator('.hd-chips[role="group"]')).toHaveCount(1);
        await expect(pop.locator('.hd-chips[role="radiogroup"]')).toHaveCount(0);
        await expect(pop.locator('.tl-pop-sec')).toHaveCount(2);
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            window.Strom.SettingsManager.setHistoryKind('place', false);
            window.Strom.SettingsManager.setHistoryKind('local', false);
            window.Strom.UI.historyChanged();
        });
        await histBtn(page).click();
        const check = pop.locator('.tl-pop-check');
        await expect(check).toHaveClass(/is-off/);
        await expect(check.locator('input')).toBeDisabled();
        await expect(check.locator('.tl-pop-hint')).toHaveText('Local history and research findings are off in Settings.');
    });

    test('German at 1024: the options fit, nothing overflows', async ({ page }) => {
        await setup(page, { width: 1024, height: 768 });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Jan');
        await timelineView(page);
        await histBtn(page).click();
        const pop = page.locator('.tl-pop.tl-pop-opts');
        await expect(pop.locator('.tl-pop-title')).toHaveText('Geschichte');
        await pop.locator('.hd-chips[role="group"] > button.hd-chip').filter({ hasText: 'Krieg' }).click();
        await expect(pop.getByRole('button', { name: 'Filter aufheben' })).toHaveCount(1);
        expect(await overflowing(page, '.tl-pop, .tl-pop *')).toEqual([]);
        const outside = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tl-pop *')].filter(el => {
            const r = el.getBoundingClientRect(), p = el.closest('.tl-pop')!.getBoundingClientRect();
            return r.width > 0 && (r.left < p.left - 0.5 || r.right > p.right + 0.5);
        }).map(el => el.className));
        expect(outside).toEqual([]);
    });

    test('phone 390: a bottom sheet with the same parts, 34 px chips; a chip keeps it open; Close gives the keyboard to the label', async ({ page }) => {
        await setup(page, { width: 390, height: 844 });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Jan');
        await timelineView(page);
        await histBtn(page).click();
        await expect(page.locator('.tl-pop')).toHaveCount(0);
        const sheet = page.locator('.bottom-sheet.tl-osheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tl-hsheet-title')).toHaveText('Geschichte');
        await expect(histBtn(page)).toHaveAttribute('aria-expanded', 'true');
        const kinds = sheet.locator('.hd-chips[role="group"] > button.hd-chip');
        await expect(kinds).toHaveCount(10);
        expect(Math.round((await kinds.first().boundingBox())!.height)).toBeGreaterThanOrEqual(34);
        await expect(sheet.locator('.hd-chips[role="radiogroup"]')).toHaveCount(1);
        await kinds.filter({ hasText: 'Krieg' }).click();
        await expect(sheet).toBeVisible();
        await expect(kinds.filter({ hasText: 'Krieg' })).toHaveAttribute('aria-pressed', 'true');
        await expect(histBtn(page).locator('.tl-hist-meta')).toHaveText('· 1 Art');
        expect(await overflowing(page, '.tl-osheet, .tl-osheet *, #timeline-container')).toEqual([]);
        await sheet.locator('.pm-lifeline-hsheet-cancel').click();
        await expect(sheet).toHaveCount(0);
        await expect(histBtn(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(histBtn(page)).toBeFocused();
        // A filter leaving nothing on a phone: the short sentence, the whole one its name.
        await page.evaluate(() => {
            window.Strom.SettingsManager.setTimelineHistory(window.Strom.DataManager.getCurrentTreeId(), { kinds: ['law'], local: false });
            window.Strom.UI.historyChanged();
        });
        const text = histRow(page).locator('.tl-hist-empty-text');
        await expect(text).toHaveText('Keine Ereignisse');
        await expect(text).toHaveAttribute('aria-label', 'Keine Ereignisse für die gewählten Arten');
        expect(await overflowing(page, '#timeline-container')).toEqual([]);
    });
});

test.describe('Timeline: the history row\'s label on touch', () => {
    test('a tap target 44 px high without a change of look; a tap opens the sheet, its chips 44 px', async ({ page }) => {
        await setup(page, { width: 390, height: 844 });
        await focusOn(page, 'Jan');
        await timelineView(page);
        const look = await histBtn(page).boundingBox();
        // Touch from here on (pointer: coarse), after the research is read.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        expect(await histBtn(page).evaluate(el => getComputedStyle(el, '::before').height)).toBe('44px');
        expect(await histBtn(page).boundingBox()).toEqual(look);
        await histBtn(page).click();
        await expect(page.locator('.bottom-sheet.tl-osheet')).toBeVisible();
        expect(Math.round((await page.locator('.tl-osheet .hd-chip').first().boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    });
});

// ==================== local history on the life lines (spec 121 §6–§8) ====================

/**
 * Two more invented events of Čapkov for the lines: a flood of 1855 (the
 * place's own history) and a finding of 1890 — with the fire of 1880 the
 * crowd's lines (1850–1900) have three, Jan's (1860–1910) two.
 */
function moreLocal(h: FakeHistory): void {
    (h.payload.events as Record<string, unknown>[]).push(
        { id: 'E10', from: 1855, kind: 'disaster', scope: 'place',
            text: { cs: 'Povodeň v Čapkovi.', en: 'A flood in Čapkov.', de: 'Hochwasser in Čapkov.' },
            source: { title: 'Invented chronicle', url: 'https://example.org/flood-1855', checked: '2026-10-01' } },
        { id: 'E11', from: 1890, kind: 'economy', scope: 'local',
            text: { cs: 'Nová cihelna.', en: 'A new brickworks.', de: 'Eine neue Ziegelei.' },
            local: { source: 'S0001', cite: 'Oddací matrika Čapkov, fol. 77' } },
    );
    const place = h.payload.places['Čapkov'] as Record<string, unknown>;
    place.events = [...(place.events as string[]), 'E10', 'E11'];
}

/** The crowd's tree with an invented forebear of 1700–1765 (Josef's father): an axis of some 210 years. */
function wideGed(): string {
    return crowdGed()
        .replace('0 @F0001@ FAM', ['0 @P0009@ INDI', '1 NAME Brumlík /Zelvarský/', '1 SEX M', '1 REFN P0009', '2 TYPE strom-research',
            '1 BIRT', '2 DATE 1700', '2 PLAC Opava', '1 DEAT', '2 DATE 1765', '1 FAMS @F0009@',
            '0 @F0009@ FAM', '1 HUSB @P0009@', '1 CHIL @P0001@', '0 @F0001@ FAM'].join('\n'))
        .replace('1 NAME Josef /Fíšek/', '1 NAME Josef /Fíšek/\n1 FAMC @F0009@');
}

/** The local option on for the tree before the Timeline is drawn. */
async function localOn(page: Page): Promise<void> {
    await page.evaluate(() => {
        const S = window.Strom;
        S.SettingsManager.setTimelineHistory(S.DataManager.getCurrentTreeId(), { local: true });
    });
}

/** A person's row on the Timeline. */
async function lineOf(page: Page, first: string) {
    const id = await page.evaluate((first) => (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[])
        .find(x => x.firstName === first)!.id, first);
    return page.locator(`#timeline-container .timeline-bar[data-person-id="${id}"]`);
}

/**
 * Within each line: no symbol's box or badge over another's (the badges of
 * one group sit on its own box's corner), all of them past the names' column.
 */
const localClashes = (page: Page) => page.evaluate(() => {
    const out: string[] = [];
    for (const row of document.querySelectorAll('#timeline-container .timeline-bar')) {
        const marks = [...row.querySelectorAll('.tl-loc')].map(g => ({
            id: g.getAttribute('data-hist-ids'),
            boxes: [...g.querySelectorAll('.tl-loc-box, .tl-loc-n')].map(el => el.getBoundingClientRect()),
        }));
        const name = row.querySelector('foreignObject')!.getBoundingClientRect();
        marks.forEach((a, i) => {
            for (const r of a.boxes) if (r.left < name.right - 0.5) out.push(`${a.id} in the names`);
            marks.slice(i + 1).forEach(b => {
                for (const r of a.boxes) for (const q of b.boxes) {
                    if (r.left < q.right - 0.5 && q.left < r.right - 0.5 && r.top < q.bottom - 0.5 && q.top < r.bottom - 0.5) out.push(`${a.id} × ${b.id}`);
                }
            });
        });
    }
    return out;
});

test.describe('Timeline: local history on the life lines (spec 121 §6–§8)', () => {
    test('the option draws the fire on Jan\'s line: a box over the bar with its tooltip, out of Tab; a click opens his card on its row', async ({ page }) => {
        await setup(page, { width: 1440, height: 900 });
        await focusOn(page, 'Josef');
        await timelineView(page);
        const jan = await lineOf(page, 'Jan');
        await expect(page.locator('#timeline-container .tl-loc')).toHaveCount(0);
        // On in the options.
        await histBtn(page).click();
        await page.locator('.tl-pop.tl-pop-opts .tl-pop-check input[type="checkbox"]').check();
        await page.keyboard.press('Escape');
        const fire = jan.locator('g.tl-loc');
        await expect(fire).toHaveCount(1);
        await expect(fire).toHaveClass(/is-local/);
        await expect(fire).toHaveAttribute('data-hist-ids', 'E4');
        await expect(fire).toHaveAttribute('aria-label', '1880 · disaster · Čapkov: A fire in Čapkov.');
        await expect(fire.locator('title')).toHaveText('1880 · disaster · Čapkov – A fire in Čapkov.\nfrom records: Oddací matrika Čapkov, fol. 41');
        await expect(fire).not.toHaveAttribute('tabindex', /.*/);
        // Josef died 1869: nothing on his line.
        await expect((await lineOf(page, 'Josef')).locator('.tl-loc')).toHaveCount(0);
        // The box lies on the bar, after (over) its dots in the SVG; the target is the row high, at most 24 px wide.
        const boxBar = await jan.evaluate(g => {
            const at = (sel: string, a: string) => Number(g.querySelector(sel)!.getAttribute(a));
            return { h: at('.tl-loc-box', 'height'), w: at('.tl-loc-box', 'width'), y: at('.tl-loc-box', 'y'), barY: at('.tl-bar-rect', 'y') };
        });
        expect(boxBar).toEqual({ h: 14, w: 14, y: boxBar.barY, barY: boxBar.barY });
        const hit = (await fire.locator('.tl-loc-hit').boundingBox())!;
        expect(hit.width).toBeLessThanOrEqual(24.01);
        expect(Math.round(hit.height)).toBe(30);
        expect(await jan.evaluate(g => [...g.children].findIndex(c => c.matches('g.tl-loc')) > [...g.children].findIndex(c => c.matches('.tl-bar-rect')))).toBe(true);

        // A click: Jan's card on the fire's row; the focus of the Timeline stays.
        await fire.click();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#input-firstname')).toHaveValue('Jan');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row[data-history-id="E4"]')).toBeVisible();
    });

    test('a kind filter applies to the lines too; the history of a place and the findings each in its colour', async ({ page }) => {
        await setup(page, { width: 1440, height: 900, crowd: true, edit: moreLocal });
        await localOn(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        const jan = await lineOf(page, 'Jan');
        await expect(jan.locator('g.tl-loc')).toHaveCount(2);
        await expect(jan.locator('g.tl-loc[data-hist-ids="E4"]')).toHaveClass(/is-local/);
        // Ilsa's line from 1854: the flood of 1855 is the place's own history.
        await expect((await lineOf(page, 'Ilsa')).locator('g.tl-loc[data-hist-ids="E10"]')).toHaveClass(/is-place/);
        // Economy only: the brickworks stays, the fire goes.
        await page.evaluate(() => {
            const S = window.Strom;
            S.SettingsManager.setTimelineHistory(S.DataManager.getCurrentTreeId(), { kinds: ['economy'], local: true });
            window.dispatchEvent(new Event('strom:timeline-history-options'));
        });
        await expect(jan.locator('g.tl-loc')).toHaveCount(1);
        await expect(jan.locator('g.tl-loc')).toHaveAttribute('data-hist-ids', 'E11');
    });

    test('phone 390 on a long axis: one symbol per line with the count of all; a tap opens the sheet with them and the card', async ({ page }) => {
        await setup(page, { width: 390, height: 844, ged: wideGed(), edit: moreLocal });
        await localOn(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        const jan = await lineOf(page, 'Jan');
        const one = jan.locator('g.tl-loc');
        await expect(one).toHaveCount(1);
        await expect(one).toHaveAttribute('data-hist-ids', 'E4 E11');
        await expect(one.locator('.tl-loc-n-txt')).toHaveText('2');
        await expect((await lineOf(page, 'Ilsa')).locator('g.tl-loc .tl-loc-n-txt')).toHaveText('3');
        await one.click();
        const sheet = page.locator('.bottom-sheet.tl-lsheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tl-hsheet-title')).toHaveText('History 1880–1890 · Jan Fíšek');
        await expect(sheet.locator('.tl-hsheet-row')).toHaveCount(2);
        await expect(sheet.locator('.tl-hsheet-row').first()).toContainText('A fire in Čapkov.');
        await expect(sheet.locator('.tl-hsheet-row').first().locator('.tl-hsheet-meta').first()).toHaveText('disaster · Čapkov');
        await sheet.getByRole('button', { name: 'Open in the person card ›' }).click();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#input-firstname')).toHaveValue('Jan');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row[data-history-id="E4"]')).toBeVisible();
    });

    for (const [w, h] of [[390, 844], [844, 390], [1024, 768], [1440, 900]] as const) {
        for (const theme of ['light', 'dark'] as const) {
            test(`${w} × ${h}, ${theme}, German, a long name: nothing wider than the window, no symbol or badge over another`, async ({ page }) => {
                await setup(page, { width: w, height: h, ged: wideGed(), edit: moreLocal });
                await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
                if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
                await localOn(page);
                await focusOn(page, 'Bartholomäus');
                await timelineView(page);
                await expect(page.locator('#timeline-container g.tl-loc').first()).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
                expect(await localClashes(page)).toEqual([]);
                // The box takes the surface over the bar in its origin's colour (a token: light and dark differ).
                const fill = await page.locator('#timeline-container .tl-loc-box').first().evaluate(el => getComputedStyle(el).fill);
                const surface = await page.evaluate(() => {
                    const probe = document.createElement('div');
                    probe.style.color = 'var(--surface)';
                    document.body.appendChild(probe);
                    const c = getComputedStyle(probe).color;
                    probe.remove();
                    return c;
                });
                expect(fill).toBe(surface);
                // The tooltip in German, a finding's source under it.
                await expect(page.locator('#timeline-container g.tl-loc[data-hist-ids~="E4"] title').first())
                    .toHaveText(/1880 · Katastrophe · Čapkov – A fire in Čapkov\.\naus Quellen: Oddací matrika Čapkov, fol\. 41/);
            });
        }
    }
});
