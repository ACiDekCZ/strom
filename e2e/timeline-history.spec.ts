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

async function setup(page: Page, opts: { width?: number; height?: number; crowd?: boolean } = {}): Promise<void> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = timelineHistory();
    const ged = opts.crowd ? crowdGed() : timelineGed();
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
