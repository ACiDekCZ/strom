import { test, expect, Page, Locator } from '@playwright/test';
import {
    fakeBridge, fakeHistoryR1, fakeHistoryDetail, historyGed, historyDetailGed, openResearch, poll,
    HISTORY_R1_FEATURES, FakeHistory,
} from './research-bridge.js';

/**
 * History symbols by kind (DEV symboly-dejin §1–§5): what happened is a
 * symbol in the row's glyph column (the origin stays the mark on the line),
 * a collapsed year names each kind with a 12 px symbol, the hidden list, the
 * detail of History of places (rows and kind chips), the legend's grid, the
 * group's mark (local > place > region), and no overflow in German on a
 * phone and on a phone held sideways. Invented data (fakeHistoryR1): Jan
 * lived in Čapkov 1860–1910.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

/** fakeHistoryR1 + an epidemic in 1866 (a year of two), Čapkov's own history (1885), and 1890 with a census and an event of the place. */
function symbolsHistory(): FakeHistory {
    const h = fakeHistoryR1();
    const capkov = { key: 'Čapkov', id: 'L0001', name: { cs: 'Čapkov', en: 'Čapkov', de: 'Čapkov' } };
    const bohemia = { id: 'cz-bohemia', name: { cs: 'Čechy', en: 'Bohemia', de: 'Böhmen' } };
    (h.payload.events as Record<string, unknown>[]).push(
        { id: 'E6', from: 1866, kind: 'epidemic', scope: 'region', region: bohemia,
            text: { cs: 'Cholera po válce.', en: 'Cholera after the war.', de: 'Cholera nach dem Krieg.' },
            source: { title: 'Invented chronicle', url: 'https://example.org/cholera-1866', checked: '2026-10-01' } },
        { id: 'E5', from: 1885, kind: 'economy', scope: 'place', place: capkov,
            text: { cs: 'Otevřen cukrovar u Čapkovi.', en: 'A sugar factory opened near Čapkov.', de: 'Eine Zuckerfabrik bei Čapkov eröffnet.' },
            source: { title: 'Invented town chronicle', url: 'https://example.org/sugar-1885', checked: '2026-10-01' } },
        { id: 'E7', from: 1890, kind: 'census', scope: 'region', region: bohemia,
            text: { cs: 'Sčítání lidu.', en: 'A census.', de: 'Eine Volkszählung.' },
            source: { title: 'Invented encyclopedia', url: 'https://example.org/census-1890', checked: '2026-10-01' } },
        { id: 'E8', from: 1890, kind: 'emigration', scope: 'place', place: capkov,
            text: { cs: 'Vystěhování do Nebrasky.', en: 'Emigration to Nebraska.', de: 'Auswanderung nach Nebraska.' },
            source: { title: 'Invented town chronicle', url: 'https://example.org/nebraska-1890', checked: '2026-10-01' } },
    );
    const place = h.payload.places['Čapkov'] as Record<string, unknown>;
    place.events = [...(place.events as string[]), 'E6', 'E5', 'E7', 'E8'];
    place.history = 'done';
    place.at = '2026-10-26T10:00:00Z';
    place.area = { cs: 'Čapkovsko', en: 'the Čapkov district', de: 'die Gegend um Čapkov' };
    return h;
}

async function setup(page: Page, opts: { history?: FakeHistory; ged?: string; width?: number; height?: number } = {}): Promise<FakeHistory> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? symbolsHistory();
    const ged = opts.ged ?? historyGed();
    await fakeBridge(page, { features: HISTORY_R1_FEATURES, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    return history;
}

async function openCard(page: Page, first = 'Jan'): Promise<void> {
    const id = await page.evaluate((first) =>
        (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

const body = (page: Page) => page.locator('#pm-lifeline-body');
const row = (page: Page, id: string) => body(page).locator(`.pm-lifeline-row.k-history[data-history-id="${id}"]`);
const group = (page: Page, year: number) => body(page).locator(`.k-historyGroup[data-history-year="${year}"]`);

/** The computed colour of a CSS colour value (a token) in the page, to compare with an element's. */
async function tokenColor(page: Page, value: string): Promise<string> {
    return page.evaluate((value) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    }, value);
}
const colorOf = (l: Locator) => l.evaluate(el => getComputedStyle(el).color);

/** The symbol of a kind: an SVG without text, hidden from a screen reader. */
async function expectSymbol(l: Locator, size: number): Promise<void> {
    const svg = l.locator('svg.hist-kind-svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(svg).toHaveAttribute('width', String(size));
    await expect(svg.locator('text, title')).toHaveCount(0);
}

test.describe('History symbols by kind', () => {
    test('the card: a symbol in the glyph column, its name on hover, coloured by the origin; the label names the kind', async ({ page }) => {
        await setup(page);
        await openCard(page);
        // A local finding: the kind's symbol and label, "from records" beside it.
        const fire = row(page, 'E4');
        await expectSymbol(fire.locator('.pm-lifeline-glyph.hist-kind'), 14);
        await expect(fire.locator('.pm-lifeline-glyph.hist-kind')).toHaveAttribute('title', 'disaster');
        await expect(fire.locator('.pm-lifeline-htag')).toHaveText('disaster');
        await expect(fire.locator('.pm-lifeline-hfrom')).toHaveText('from records');
        expect(await colorOf(fire.locator('.pm-lifeline-glyph.hist-kind'))).toBe(await tokenColor(page, 'var(--hist-local-text)'));
        expect(await colorOf(fire.locator('.pm-lifeline-hfrom'))).toBe(await tokenColor(page, 'var(--hist-local-text)'));
        // The mark on the line stays the origin's.
        await expect(fire).toHaveClass(/is-local/);
        await expect(fire.locator('.pm-lifeline-hmark')).toHaveCount(1);
        // A place's own history: its colour.
        const sugar = row(page, 'E5');
        await expect(sugar.locator('.pm-lifeline-glyph.hist-kind')).toHaveAttribute('title', 'economy');
        expect(await colorOf(sugar.locator('.pm-lifeline-glyph.hist-kind'))).toBe(await tokenColor(page, 'var(--hist-place-text)'));
        // A region's event: its colour; the label as before.
        const state = row(page, 'E3');
        await expect(state.locator('.pm-lifeline-glyph.hist-kind')).toHaveAttribute('title', 'state and borders');
        await expect(state.locator('.pm-lifeline-htag')).toHaveText('state and borders');
        await expect(state.locator('.pm-lifeline-hfrom')).toHaveCount(0);
        expect(await colorOf(state.locator('.pm-lifeline-glyph.hist-kind'))).toBe(await tokenColor(page, 'var(--hist-text)'));
        // The person's own rows keep their glyphs; the state rows have none.
        await expect(body(page).locator('.k-historyState .hist-kind')).toHaveCount(0);
    });

    test('a collapsed year: a 12 px symbol before each kind, the text as before; unfolded each row its 14 px symbol', async ({ page }) => {
        await setup(page);
        await openCard(page);
        const y1866 = group(page, 1866);
        await expect(y1866.locator('.pm-lifeline-desc')).toHaveText('2 events: war, epidemic');
        await expect(y1866.locator('.pm-lifeline-glyph svg')).toHaveCount(0);
        const parts = y1866.locator('.hist-kind-part');
        await expect(parts).toHaveText(['war,', 'epidemic']);
        await expect(parts.locator('.hist-kind')).toHaveCount(2);
        expect(await parts.locator('.hist-kind').evaluateAll(els => els.map(e => e.getAttribute('title')))).toEqual(['war', 'epidemic']);
        for (const p of await parts.all()) await expectSymbol(p, 12);
        await expect(parts.first().locator('svg')).toHaveAttribute('stroke-width', '2.2');
        // The year's mark: a region; a year with an event of the place (no local finding): ▲.
        await expect(y1866).toHaveClass(/is-region/);
        const y1890 = group(page, 1890);
        await expect(y1890).toHaveClass(/is-place/);
        await expect(y1890.locator('.pm-lifeline-desc')).toHaveText('2 events: census, emigration');
        expect(await colorOf(y1890.locator('.hist-kind').nth(1))).toBe(await tokenColor(page, 'var(--hist-place-text)'));
        expect(await colorOf(y1890.locator('.hist-kind').nth(0))).toBe(await tokenColor(page, 'var(--hist-text)'));
        // Unfolded: only the count, the rows with their symbols.
        await y1866.click();
        await expect(group(page, 1866).locator('.pm-lifeline-desc')).toHaveText('2 events');
        await expect(group(page, 1866).locator('.hist-kind')).toHaveCount(0);
        await expectSymbol(row(page, 'E1').locator('.pm-lifeline-glyph'), 14);
        await expect(row(page, 'E1').locator('.pm-lifeline-glyph')).toHaveAttribute('title', 'war');
        await expect(row(page, 'E6').locator('.pm-lifeline-glyph')).toHaveAttribute('title', 'epidemic');
    });

    test('Hidden: the symbol in the faint colour of the hidden row', async ({ page }) => {
        await setup(page);
        await openCard(page);
        await page.locator('.pm-lifeline-hidden').click();
        const item = page.locator('.pm-lifeline-hiddenitem');
        await expect(item).toHaveCount(1);
        await expectSymbol(item.locator('.pm-lifeline-glyph.hist-kind'), 14);
        await expect(item.locator('.pm-lifeline-glyph.hist-kind')).toHaveAttribute('title', 'economy');
        expect(await colorOf(item.locator('.pm-lifeline-glyph.hist-kind'))).toBe(await tokenColor(page, 'var(--text-faint)'));
    });

    test('the legend: the origins under their title, then the grid of all nine kinds', async ({ page }) => {
        await setup(page);
        await openCard(page);
        await page.locator('.pm-lifeline-hinfo').click();
        const legend = page.locator('.pm-lifeline-legend-pop');
        await expect(legend.locator('.pm-lifeline-legend-sub')).toHaveText(['Where from · mark on the line', 'What happened · symbol by the text']);
        await expect(legend.locator('.pm-lifeline-legend-name')).toHaveText(['Regional history', 'Local history', 'From research records', 'Research tip']);
        await expect(legend).toContainText('From a verified source the research downloaded.');
        await expect(legend).not.toContainText('The label gives the kind');
        const kinds = legend.locator('.pm-lifeline-legend-kind');
        await expect(kinds).toHaveText(['war', 'epidemic', 'census', 'state and borders', 'emigration', 'law', 'economy', 'disaster', 'other']);
        for (const k of await kinds.all()) await expectSymbol(k, 14);
        // Two columns.
        const [a, b] = await Promise.all([kinds.nth(0).boundingBox(), kinds.nth(1).boundingBox()]);
        expect(Math.round(a!.y)).toBe(Math.round(b!.y));
        expect(b!.x).toBeGreaterThan(a!.x);
    });

    test('History of places, a detail: the kind\'s symbol in place of the mark, and in the kind chips', async ({ page }) => {
        await setup(page, { history: fakeHistoryDetail(), ged: historyDetailGed() });
        await page.evaluate(() => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage({}));
        const modal = page.locator('#history-modal');
        await expect(page.locator('#history-manage-state .hm-state-text')).not.toHaveText('Loading history…');
        await modal.locator('.hm-region[data-key="cz-bohemia"]').click();
        await expect(modal).toHaveClass(/is-detail/);
        // The head keeps the origin's mark.
        await expect(modal.locator('.hm-detail-title .hm-mark.is-region')).toHaveCount(1);
        const rows = modal.locator('.hd-ev');
        const n = await rows.count();
        expect(n).toBeGreaterThan(0);
        await expect(rows.locator('.hd-mark.hd-kind svg.hist-kind-svg')).toHaveCount(n);
        const war = modal.locator('.hd-ev[data-history-id="E1"] .hd-kind');
        await expect(war).toHaveAttribute('title', 'war');
        await expectSymbol(war, 14);
        // The origin's shape is gone from the row's mark.
        expect(await war.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
        // Kind chips: a 12 px symbol before the name; "All" none.
        const chips = modal.locator('.hd-filters .hd-chip');
        await expect(chips.first()).toHaveText('All');
        await expect(chips.first().locator('svg')).toHaveCount(0);
        const kindChips = chips.filter({ has: page.locator('svg.hist-kind-svg') });
        await expect(kindChips).toHaveCount(await chips.count() - 1);
        await expect(modal.locator('.hd-filters .hd-chip[data-k="war"]')).toHaveAttribute('title', 'War');
        await expectSymbol(modal.locator('.hd-filters .hd-chip[data-k="war"]'), 12);
        // The filter is a neutral control: its symbol in --hist-text, also when chosen (the origin is the head's).
        const warSvg = modal.locator('.hd-filters .hd-chip[data-k="war"] svg');
        expect(await colorOf(warSvg)).toBe(await tokenColor(page, 'var(--hist-text)'));
        await modal.locator('.hd-filters .hd-chip[data-k="war"]').click();
        await expect(modal.locator('.hd-filters .hd-chip[data-k="war"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await colorOf(warSvg)).toBe(await tokenColor(page, 'var(--hist-text)'));
        await modal.locator('.hd-filters .hd-chip').first().click();

        // The local findings: their own colour, places as chips (no symbol there).
        await modal.locator('.hm-back').click();
        await modal.locator('.hm-region[data-key="local"]').click();
        const fire = modal.locator('.hd-ev[data-history-id="L0031"] .hd-kind');
        await expect(fire).toHaveAttribute('title', 'disaster');
        expect(await colorOf(fire)).toBe(await tokenColor(page, 'var(--hist-local-text)'));
        await expect(modal.locator('.hd-filters .hd-chip svg')).toHaveCount(0);
    });

    test('phone: the legend sheet a 16 px grid; the Kind sheet\'s chips carry a 14 px symbol', async ({ page }) => {
        await setup(page, { history: fakeHistoryDetail(), ged: historyDetailGed(), width: 390, height: 844 });
        await openCard(page);
        await page.locator('.pm-lifeline-hinfo').click();
        const legend = page.locator('.pm-lifeline-legend-sheet');
        await expect(legend.locator('.pm-lifeline-legend-kind')).toHaveCount(9);
        await expectSymbol(legend.locator('.pm-lifeline-legend-kind').first(), 16);
        await legend.locator('.pm-lifeline-hsheet-cancel').click();
        await page.evaluate(() => window.Strom.UI.forceCloseModal());

        await page.evaluate(() => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage({}));
        const modal = page.locator('#history-modal');
        await expect(page.locator('#history-manage-state .hm-state-text')).not.toHaveText('Loading history…');
        await modal.locator('.hm-region[data-key="cz-bohemia"]').click();
        await modal.locator('[data-hd="sheet"]').click();
        const sheet = page.locator('.bottom-sheet.hd-fsheet');
        await expect(sheet).toBeVisible();
        await expectSymbol(sheet.locator('[data-fs="facet"][data-k="war"]'), 14);
        await expect(sheet.locator('[data-fs="facet"][data-k=""] svg')).toHaveCount(0);
    });

    test.describe('German', () => {
        test.use({ locale: 'de-DE' });

        /** No row, cluster or label wider than its box. */
        async function noOverflow(page: Page): Promise<void> {
            const over = await body(page).evaluate(b => [...b.querySelectorAll<HTMLElement>('.pm-lifeline-row.k-history, .k-historyGroup, .pm-lifeline-htag')]
                .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className + ': ' + el.textContent));
            expect(over).toEqual([]);
        }

        test('phone 390: the kinds\' names fit; a collapsed year names its kinds', async ({ page }) => {
            await setup(page, { width: 390, height: 844 });
            await openCard(page);
            await expect(group(page, 1890).locator('.pm-lifeline-desc')).toHaveText('2 Ereignisse: Volkszählung, Auswanderung');
            await group(page, 1890).click();
            await group(page, 1866).click();
            await expect(row(page, 'E3').locator('.pm-lifeline-htag')).toHaveText('Staat und Grenzen');
            await expect(row(page, 'E4').locator('.pm-lifeline-hfrom')).toHaveText('aus Quellen');
            await noOverflow(page);
        });

        test('phone held sideways 844 × 390: every year collapsed with its symbols, nothing overflows', async ({ page }) => {
            await setup(page, { width: 844, height: 390 });
            await openCard(page);
            const groups = body(page).locator('.k-historyGroup');
            await expect(groups.first()).toBeVisible();
            await expect(body(page).locator('.pm-lifeline-row.k-history')).toHaveCount(0);
            // A single event of a year: its symbol before its text.
            const single = body(page).locator('.k-historyGroup[data-history-year="1880"]');
            await expect(single).toHaveText(/Čapkov/);
            await expect(single.locator('.hist-kind-lead')).toHaveAttribute('title', 'Katastrophe');
            await expectSymbol(single.locator('.hist-kind-lead'), 12);
            await expect(group(page, 1866).locator('.hist-kind-part')).toHaveText(['Krieg,', 'Epidemie']);
            await noOverflow(page);
        });
    });
});
