import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, historyGed, openResearch, poll, HISTORY_R1_FEATURES, FakeHistory,
} from './research-bridge.js';
import { openApp } from './helpers.js';

/**
 * The Timeline view's history row (DEV symboly-dejin §9, variant 9a): one
 * row "History · name" under the axis band for the FOCUSED person only, the
 * card's events (the layer, the tie to a research, the card's chip), each
 * cluster the first event's kind symbol with a count; a click opens the card
 * on the first event's year, a phone shows a sheet. Nothing without a
 * research. Invented data: Jan lived in Čapkov 1860–1910, Josef 1830–1869.
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

async function setup(page: Page, opts: { width?: number; height?: number } = {}): Promise<void> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = timelineHistory();
    const ged = timelineGed();
    await fakeBridge(page, { features: HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
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
    test('only the focused person, under the axis; a change of focus changes the row; the rows move down by it', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        await expect(histRow(page)).toHaveCount(1);
        await expect(histRow(page).locator('.tl-hist-label')).toHaveText('History · Jan Fíšek');
        await expect(page.locator('#timeline-container .tl-rows')).toHaveAttribute('transform', 'translate(0 28)');
        // 1866 (war + epidemic) one cluster: the first event's symbol and a count.
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        await expect(y1866).toHaveAttribute('aria-label', /^1866(–1867)?: war, epidemic/);
        await expect(y1866).toHaveAttribute('role', 'button');
        await expect(y1866.locator('svg.hist-kind-svg')).toHaveCount(1);
        await expect(y1866.locator('svg.hist-kind-svg')).toHaveAttribute('aria-hidden', 'true');
        await expect(y1866.locator('.tl-hist-n-txt')).not.toHaveText('');
        // The local finding (1880 fire) coloured by its origin.
        const fire = clusters(page).and(page.locator('[aria-label^="1880"]'));
        await expect(fire).toHaveClass(/is-local/);
        const janIds = await clusters(page).evaluateAll(els => els.map(e => e.getAttribute('data-hist-ids')).join(' '));
        expect(janIds).toContain('E4');

        // Josef: only his years (1866–1867), his name in the label.
        await focusOn(page, 'Josef');
        await expect(histRow(page).locator('.tl-hist-label')).toHaveText('History · Josef Fíšek');
        const josefIds = await clusters(page).evaluateAll(els => els.map(e => e.getAttribute('data-hist-ids')).join(' '));
        expect(josefIds).not.toContain('E4');
        expect(josefIds).toContain('E1');

        // Anna has no years: no row, the rows back up.
        await focusOn(page, 'Anna');
        await expect(histRow(page)).toHaveCount(0);
        await expect(page.locator('#timeline-container .tl-rows')).toHaveCount(0);
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

    test('a click (and Enter) on a cluster opens the card on the first event, its year unfolded', async ({ page }) => {
        await setup(page);
        await focusOn(page, 'Jan');
        await timelineView(page);
        const y1866 = clusters(page).and(page.locator('[aria-label^="1866"]'));
        await y1866.click();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#input-firstname')).toHaveValue('Jan');
        const group = page.locator('#pm-lifeline-body .k-historyGroup[data-history-year="1866"]');
        await expect(group).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-history[data-history-id="E1"]')).toBeVisible();
        // Keyboard: Enter on a focused cluster.
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        const fire = clusters(page).and(page.locator('[aria-label^="1880"]'));
        await fire.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-history[data-history-id="E4"]')).toBeVisible();
    });

    test('phone 390: "History" alone, a sheet with the cluster\'s events and "Open in the person card"; nothing overflows', async ({ page }) => {
        await setup(page, { width: 390, height: 844 });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await focusOn(page, 'Jan');
        await timelineView(page);
        await expect(histRow(page).locator('.tl-hist-label')).toHaveText('Geschichte');
        await expect(page.locator('#timeline-container .tl-rows')).toHaveAttribute('transform', 'translate(0 26)');
        const first = clusters(page).first();
        const ids = (await first.getAttribute('data-hist-ids'))!.split(' ');
        await first.click();
        const sheet = page.locator('.bottom-sheet.tl-hsheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.tl-hsheet-title')).toContainText('Geschichte');
        await expect(sheet.locator('.tl-hsheet-title')).toContainText('Jan Fíšek');
        await expect(sheet.locator('.tl-hsheet-row')).toHaveCount(ids.length);
        await expect(sheet.locator('.tl-hsheet-row svg.hist-kind-svg')).toHaveCount(ids.length);
        const over = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll('.tl-hsheet, .tl-hsheet *, #timeline-container')]
            .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' || el === document.documentElement && el.scrollWidth > el.clientWidth)
            .map(el => (el as HTMLElement).className || el.tagName));
        expect(over).toEqual([]);
        // Closing: the Close button.
        await sheet.locator('.pm-lifeline-hsheet-cancel').click();
        await expect(sheet).toHaveCount(0);
        // Again, then "Open in the person card": the card on the first event.
        await first.click();
        await page.locator('.bottom-sheet.tl-hsheet .tl-hsheet-open').click();
        await expect(page.locator('.bottom-sheet.tl-hsheet')).toHaveCount(0);
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(page.locator(`#pm-lifeline-body [data-history-id="${decodeURIComponent(ids[0])}"]`).first()).toBeAttached();
    });

    test('a tree without a research: no row, no extra height', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await timelineView(page);
        await expect(page.locator('#timeline-container .tl-hist-row, #timeline-container .tl-rows')).toHaveCount(0);
    });
});
