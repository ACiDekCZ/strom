import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeHistoryDetail, historyDetailGed, openResearch, poll, touchScreenNow,
    HISTORY_R1_FEATURES, FakeBridge, FakeHistory,
} from './research-bridge.js';

/**
 * "History of places", a detail (#history-modal.is-detail, spec 020 K4.3/K4.4,
 * work 1028 part B): a region's events and the local findings, its head and
 * state, the centuries (folded above 40 events), the filters on a desktop and
 * on a phone (the "Filter" sheet), "who sees it", the event's menu with its
 * gates and second levels, hiding with Undo, deleting (variant A: restorable)
 * with its refusals, and the detail without the bridge.
 * Invented data (fakeHistoryDetail, historyDetailGed): Jan lived in Čáslav
 * 1860–1910, twelve more people there 1840–1900, two in Kutná Hora 1845–1895.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'experiment'];

async function setup(page: Page, opts: { history?: FakeHistory; features?: string[]; width?: number; height?: number } = {}):
    Promise<{ bridge: FakeBridge; history: FakeHistory }> {
    if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 844 });
    const history = opts.history ?? fakeHistoryDetail();
    const ged = historyDetailGed();
    const features = opts.features ?? HISTORY_R1_FEATURES;
    const bridge = await fakeBridge(page, { features, history, treeGed: ged, links: LINKS });
    await openResearch(page, { ged });
    await poll(page);
    await expect.poll(() => history.reads).toBeGreaterThan(0);
    return { bridge, history };
}

const modal = (page: Page) => page.locator('#history-modal');
const rows = (page: Page) => modal(page).locator('.hd-ev');
const ev = (page: Page, id: string) => modal(page).locator(`.hd-ev[data-history-id="${id}"]`);
const texts = (page: Page) => rows(page).locator('.pm-lifeline-htext');
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });
const confirmModal = (page: Page) => page.locator('#confirmation-modal');
const scopes = (page: Page, root: string) => page.locator(`${root} [data-scope]`)
    .evaluateAll(els => els.map(e => (e as HTMLElement).dataset.scope ?? ''));

const BOHEMIA_TEXTS = ['Plague in the region.', 'The abolition of serfdom.', 'Volkszählung in Böhmen. text in German',
    'Austro-Prussian War; fighting around Čáslav.', 'Vienna stock exchange crash.', 'Emigration to America.', 'The Great War.'];

/** The manager on its regions, then a detail by its row (a region id or `local`). */
async function openDetail(page: Page, key: string): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openHistoryManage(o: object): void }).openHistoryManage({}));
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#history-manage-state .hm-state-text')).not.toHaveText('Loading history…');
    await modal(page).locator(`.hm-region[data-key="${key}"]`).click();
    await expect(modal(page)).toHaveClass(/is-detail/);
    await expect(modal(page).locator(`.hm-detail-body[data-key="${key}"]`)).toBeVisible();
}

/** An event's "⋯" (a popup on a desktop): its items' scopes. */
async function eventMenu(page: Page, id: string): Promise<string[]> {
    await ev(page, id).locator('[data-hd="menu"]').click();
    await expect(page.locator('.hd-menu')).toBeVisible();
    return scopes(page, '.hd-menu');
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

test.describe('History of places: a detail', () => {
    test('a region: head, state, the events by centuries with their rows (place, audience, source, excerpt, language, hiding)', { tag: '@smoke' }, async ({ page }) => {
        const { history } = await setup(page);
        await openDetail(page, 'cz-bohemia');
        await expect(modal(page).locator('.hm-detail-name')).toHaveText('Bohemia');
        await expect(modal(page).locator('.hm-detail-title .hm-mark.is-region')).toHaveCount(1);
        await expect(modal(page).locator('.hm-detail-title')).toBeFocused();
        await expect(modal(page).locator('.hm-detail-state')).toHaveText(/^Done · 7 events · completed .+ · 1 hidden · years without events 1870–1913 · filling queued$/);
        await expect(modal(page).locator('.hm-detail-dots[data-kind="region"]')).toBeVisible();

        // Under 40 events every century is open.
        const heads = modal(page).locator('.hd-century-head');
        await expect(heads).toHaveText([/1700–1799 · 1/, /1800–1899 · 5/, /1900–1999 · 1/]);
        await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
        await expect(heads.nth(2)).toHaveAttribute('aria-expanded', 'true');
        await expect(texts(page)).toHaveText(BOHEMIA_TEXTS);
        await expect(rows(page).locator('.pm-lifeline-year')).toHaveText(['1755', '1848', '1850', '1866', '1873', '1880', '1914–1918']);

        // The kind's tag, the people who see it, its source.
        await expect(ev(page, 'E1').locator('.pm-lifeline-htag')).toHaveText('war');
        await expect(ev(page, 'E1').locator('.hd-sees')).toHaveText('15 people will see it');
        await expect(ev(page, 'E11').locator('.hd-sees')).toHaveText('12 people will see it');
        await expect(ev(page, 'E10').locator('.hd-sees-none')).toHaveText('nobody sees it on a card');
        await expect(ev(page, 'E14').locator('.hd-sees-none')).toHaveCount(1);
        await expect(ev(page, 'E10').locator('.pm-lifeline-hsrc a')).toHaveAttribute('href', 'https://example.org/plague-1755');
        // A region's rows have no place of their own.
        await expect(rows(page).locator('.hd-place')).toHaveCount(0);

        // Only a German text: shown with its language.
        await expect(ev(page, 'E12').locator('.pm-lifeline-htext')).toHaveAttribute('lang', 'de');
        await expect(ev(page, 'E12').locator('.pm-lifeline-hlang')).toHaveText('text in German');
        await expect(ev(page, 'E1').locator('.pm-lifeline-hlang')).toHaveCount(0);

        // The excerpt opens under the row (only with source.quote).
        await expect(rows(page).locator('[data-hd="quote"]')).toHaveCount(1);
        await ev(page, 'E11').locator('[data-hd="quote"]').click();
        await expect(ev(page, 'E11').locator('[data-hd="quote"]')).toHaveAttribute('aria-expanded', 'true');
        await expect(ev(page, 'E11').locator('.pm-lifeline-hquotetext')).toHaveText('“Robota se ruší na věčné časy.”');

        // Hidden at a place: the row normal, its sentence with Undo.
        await expect(ev(page, 'E2')).not.toHaveClass(/is-dim/);
        await expect(ev(page, 'E2').locator('.hd-hide-note')).toContainText('Hidden at Čáslav');
        await ev(page, 'E2').locator('[data-hd="unhide"]').click();
        await expect.poll(() => history.hides).toEqual([{ event: 'E2', place: 'Čáslav', do: 'show' }]);
        await expect(ev(page, 'E2').locator('.hd-hide-note')).toHaveCount(0);
        await expect(ev(page, 'E2').locator('.hd-sees')).toHaveText('13 people will see it');

        // A century folds and opens again.
        await heads.nth(1).click();
        await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'false');
        await expect(rows(page)).toHaveCount(2);
        await heads.nth(1).click();
        await expect(rows(page)).toHaveCount(7);
    });

    test('above 40 events only the largest century is open; the local findings: places, no centuries, a citation', async ({ page }) => {
        await setup(page, { history: fakeHistoryDetail({ many: true }) });
        await openDetail(page, 'cz-bohemia');
        const heads = modal(page).locator('.hd-century-head');
        await expect(heads).toHaveText([/1700–1799 · 11/, /1800–1899 · 35/, /1900–1999 · 6/]);
        await expect(heads.evaluateAll(els => els.map(e => e.getAttribute('aria-expanded')))).resolves.toEqual(['false', 'true', 'false']);
        await expect(rows(page)).toHaveCount(35);
        await heads.nth(0).click();
        await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
        await expect(rows(page)).toHaveCount(46);
        // A filter leaving 40 events or fewer: its centuries open.
        await modal(page).locator('input[data-hd="q"]').fill('The Great War');
        await expect(heads).toHaveText([/1900–1999 · 1/]);
        await expect(heads.nth(0)).toHaveAttribute('aria-expanded', 'true');
        await expect(texts(page)).toHaveText(['The Great War.']);

        await modal(page).locator('.hm-back').click();
        await modal(page).locator('.hm-region[data-key="local"]').click();
        await expect(modal(page).locator('.hm-detail-name')).toHaveText('From research sources');
        await expect(modal(page).locator('.hm-detail-title .hm-mark.is-local')).toHaveCount(1);
        await expect(modal(page).locator('.hm-detail-sub')).toHaveText('local findings of the tree');
        await expect(modal(page).locator('.hm-detail-state')).toHaveText('3 events from registers and chronicles the research read in the tree. They apply to this tree only.');
        await expect(modal(page).locator('.hd-century')).toHaveCount(0);
        await expect(texts(page)).toHaveText(['A hailstorm destroyed the harvest.', 'A fire in Čáslav.', 'A new school opened.']);
        await expect(rows(page).locator('.hd-place')).toHaveText(['Čáslav', 'Čáslav', 'Kutná Hora']);
        await expect(rows(page).first().locator('.pm-lifeline-htag')).toHaveText('from research records');
        // Places instead of kinds, by count.
        const chips = modal(page).locator('.hd-filters .hd-chip');
        await expect(chips).toHaveText(['All', 'Čáslav 2', 'Kutná Hora 1']);
        await chips.nth(2).click();
        await expect(texts(page)).toHaveText(['A new school opened.']);
        await chips.nth(0).click();
        // The cited source in the tree: a link; one not in the tree: only its text.
        await expect(ev(page, 'E4').locator('[data-hd="cite"]')).toHaveText('Oddací matrika Čáslav, fol. 41');
        await expect(ev(page, 'L0031').locator('[data-hd="cite"]')).toHaveCount(0);
        await expect(ev(page, 'L0031').locator('.pm-lifeline-hsrc')).toHaveText('Kronika Čáslav, s. 12');
        // Two people see L0032: hiding for one person has no search.
        await eventMenu(page, 'L0032');
        await page.locator('.hd-menu [data-scope="person"]').click();
        await expect(page.locator('.hd-menu [data-scope^="o:"]')).toHaveText([/Marie Pokorná/, /Nina Růžičková/]);
        await expect(page.locator('.hd-menu-search')).toHaveCount(0);
    });

    test('filters on a desktop: kinds with counts, a century and a custom range, text and source, hidden only', async ({ page }) => {
        await setup(page);
        await openDetail(page, 'cz-bohemia');
        const chips = modal(page).locator('.hd-filters .hd-chip');
        await expect(chips).toHaveText(['All', 'War 2', 'Epidemic 1', 'Census 1', 'Emigration 1', 'Law 1', 'Economy 1']);
        await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
        const chip = (k: string) => modal(page).locator(`.hd-filters .hd-chip[data-k="${k}"]`);
        await chip('war').click();
        await expect(chip('war')).toHaveAttribute('aria-pressed', 'true');
        await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false');
        await expect(texts(page)).toHaveText(['Austro-Prussian War; fighting around Čáslav.', 'The Great War.']);
        // More kinds at once.
        await chip('law').click();
        await expect(rows(page)).toHaveCount(3);
        await chips.nth(0).click();
        await expect(rows(page)).toHaveCount(7);

        // A century: the kinds count only within it.
        const period = modal(page).locator('select[data-hd="period"]');
        await expect(period.locator('option')).toHaveText(['all', '1700–1799', '1800–1899', '1900–1999', 'Custom range…']);
        await period.selectOption('c:18');
        await expect(rows(page)).toHaveCount(5);
        await expect(chip('war').locator('.hd-chip-n')).toHaveText('1');
        await expect(chip('epidemic')).toHaveCount(0);
        // A custom range.
        await modal(page).locator('select[data-hd="period"]').selectOption('custom');
        await modal(page).locator('input[data-hd="from"]').fill('1860');
        await modal(page).locator('input[data-hd="from"]').dispatchEvent('change');
        await modal(page).locator('input[data-hd="to"]').fill('1875');
        await modal(page).locator('input[data-hd="to"]').dispatchEvent('change');
        await expect(texts(page)).toHaveText(['Austro-Prussian War; fighting around Čáslav.', 'Vienna stock exchange crash.']);
        await expect(modal(page).locator('select[data-hd="period"]')).toHaveValue('custom');
        await modal(page).locator('select[data-hd="period"]').selectOption('');
        await expect(rows(page)).toHaveCount(7);
        await expect(modal(page).locator('input[data-hd="from"]')).toHaveCount(0);

        // Text: the event's and its source's (the excerpt's words), Escape clears it.
        const q = modal(page).locator('input[data-hd="q"]');
        await q.fill('serfdom');
        await expect(texts(page)).toHaveText(['The abolition of serfdom.']);
        await q.fill('vecne casy');
        await expect(texts(page)).toHaveText(['The abolition of serfdom.']);
        await q.fill('nothing like it');
        await expect(modal(page).locator('.hd-list > .hm-empty')).toHaveText('No event matches the filter.');
        await modal(page).locator('input[data-hd="q"]').press('Escape');
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('input[data-hd="q"]')).toHaveValue('');
        await expect(rows(page)).toHaveCount(7);

        // Hidden only (the count of hidden events).
        await expect(modal(page).locator('.hd-hidden-only')).toHaveText(/Hidden only\s*1/);
        await modal(page).locator('input[data-hd="hiddenOnly"]').check();
        await expect(texts(page)).toHaveText(['Vienna stock exchange crash.']);
        await modal(page).locator('input[data-hd="hiddenOnly"]').uncheck();
        await expect(rows(page)).toHaveCount(7);

        // Kept while the dialog is open (back and in again), gone when it closes.
        await chip('war').click();
        await modal(page).locator('.hm-back').click();
        await modal(page).locator('.hm-region[data-key="cz-bohemia"]').click();
        await expect(rows(page)).toHaveCount(2);
        await modal(page).locator('.buttons [data-dismiss]').click();
        await expect(modal(page)).toBeHidden();
        await openDetail(page, 'cz-bohemia');
        await expect(rows(page)).toHaveCount(7);
    });

    test('phone (390 px): one row of chips, the Filter sheet with a live count and Clear filter, the menu a sheet', async ({ page }) => {
        const { history } = await setup(page, { width: 390, height: 844 });
        await openDetail(page, 'cz-bohemia');
        await expect(modal(page).locator('.hd-filters')).toBeHidden();
        const mchips = modal(page).locator('.hd-mfilters .hd-mchip');
        await expect(mchips).toHaveText(['Kind ▾', 'Period ▾', 'Hidden only', 'Search']);
        const fits = await modal(page).locator('.hm-detail-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
        expect(fits).toBe(true);

        await modal(page).locator('[data-hd="sheet"]').click();
        const sheet = page.locator('.bottom-sheet.hd-fsheet');
        await expect(sheet).toBeVisible();
        const show = sheet.locator('[data-fs="show"]');
        await expect(show).toHaveText('Show 7 events');
        await sheet.locator('[data-fs="facet"][data-k="war"]').click();
        await expect(show).toHaveText('Show 2 events');
        await sheet.locator('[data-fs="period"][data-c="18"]').click();
        await expect(show).toHaveText('Show 1 event');
        await show.click();
        await expect(sheet).toHaveCount(0);
        await expect(modal(page).locator('[data-hd="sheet"]')).toHaveText('Kind · 1');
        await expect(modal(page).locator('[data-hd="sheet"]')).toHaveClass(/is-on/);
        await expect(modal(page).locator('[data-hd="sheetPeriod"]')).toHaveText('1800–1899');
        await expect(texts(page)).toHaveText(['Austro-Prussian War; fighting around Čáslav.']);

        // A custom range in the sheet.
        await modal(page).locator('[data-hd="sheetPeriod"]').click();
        await sheet.locator('input[data-fs="from"]').fill('1800');
        await sheet.locator('input[data-fs="from"]').dispatchEvent('change');
        await sheet.locator('input[data-fs="to"]').fill('1999');
        await sheet.locator('input[data-fs="to"]').dispatchEvent('change');
        await expect(show).toHaveText('Show 2 events');
        // Clear filter: everything again.
        await sheet.locator('[data-fs="clear"]').click();
        await expect(sheet).toHaveCount(0);
        await expect(mchips).toHaveText(['Kind ▾', 'Period ▾', 'Hidden only', 'Search']);
        await expect(rows(page)).toHaveCount(7);

        // Hidden only and the search over the chips.
        await modal(page).locator('[data-hd="hiddenOnlyChip"]').click();
        await expect(modal(page).locator('[data-hd="hiddenOnlyChip"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(rows(page)).toHaveCount(1);
        await modal(page).locator('[data-hd="hiddenOnlyChip"]').click();
        await modal(page).locator('[data-hd="search"]').click();
        await expect(modal(page).locator('.hd-mfilters.is-search input[data-hfocus="mq"]')).toBeFocused();
        await page.keyboard.type('plague');
        await expect(texts(page)).toHaveText(['Plague in the region.']);
        await modal(page).locator('[data-hd="searchClose"]').click();
        await expect(modal(page).locator('[data-hd="search"]')).toHaveText('Search: plague');
        await expect(modal(page).locator('[data-hd="search"]')).toBeFocused();

        // The event's "⋯": a bottom sheet; a second level replaces it.
        await modal(page).locator('[data-hd="search"]').click();
        await page.keyboard.press('Escape');
        await expect(rows(page)).toHaveCount(7);
        await ev(page, 'E1').locator('[data-hd="menu"]').click();
        const menu = page.locator('.bottom-sheet.hd-menu-sheet');
        await expect(menu).toBeVisible();
        expect(await scopes(page, '.bottom-sheet.hd-menu-sheet')).toEqual(['who', 'hideTree', 'place', 'person', 'delete', 'cancel']);
        await menu.locator('[data-scope="place"]').click();
        expect(await scopes(page, '.bottom-sheet.hd-menu-sheet')).toEqual(['back', 'p:Čáslav', 'p:Kutná Hora']);
        await menu.locator('[data-scope="back"]').click();
        await menu.locator('[data-scope="cancel"]').click();
        await expect(menu).toHaveCount(0);
        expect(history.hides).toEqual([]);
    });

    test('phone with a touch screen: a long name wraps under its mark, the Filter sheet\'s chips are 44 px', async ({ page }) => {
        const history = fakeHistoryDetail();
        const bohemia = history.payload.regions!['cz-bohemia'];
        bohemia.name = { ...(bohemia.name as Record<string, string>), en: 'Kingdom of Bohemia and County of Kladsko' };
        await setup(page, { history, width: 390, height: 844 });
        await touchScreenNow(page);
        await openDetail(page, 'cz-bohemia');
        // The mark sits on the name's first line, never alone on a line above it.
        const lines = await modal(page).locator('.hm-detail-title').evaluate(el => {
            const mark = el.querySelector('.hm-mark')!.getBoundingClientRect();
            const name = el.querySelector('.hm-detail-name')!.getClientRects();
            return { markMid: mark.top + mark.height / 2, first: { top: name[0].top, bottom: name[0].bottom }, lines: name.length };
        });
        expect(lines.lines).toBeGreaterThan(1);
        expect(lines.markMid).toBeGreaterThan(lines.first.top);
        expect(lines.markMid).toBeLessThan(lines.first.bottom);
        await modal(page).locator('[data-hd="sheet"]').click();
        const chips = page.locator('.bottom-sheet.hd-fsheet button.hd-chip');
        await expect(chips.first()).toBeVisible();
        const heights = await chips.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    });

    test('who sees it: the first six and "n more"; a person opens the card on the event, flashing', async ({ page }) => {
        await setup(page);
        await openDetail(page, 'cz-bohemia');
        await ev(page, 'E1').locator('[data-hd="who"]').click();
        const pop = page.locator('.hd-who-pop[role="dialog"]');
        await expect(pop).toBeVisible();
        await expect(pop.locator('.hd-who-title')).toHaveText('Seen on the card by 15 people');
        await expect(pop.locator('.hd-who-note')).toHaveText('They lived in Bohemia in 1866.');
        const people = pop.locator('.hd-who-person .hd-who-name');
        await expect(people).toHaveText(['Adam Bárta', 'Bedřich Černý', 'Cyril Dvořák', 'Daniel Erben', 'Emil Fiala', 'František Hora']);
        await expect(pop.locator('.hd-who-person').first().locator('.hd-who-meta')).toHaveText('1840–1900 · Čáslav');
        await pop.locator('.hd-who-more').click();
        await expect(people).toHaveCount(15);
        await expect(pop.locator('.hd-who-more')).toHaveCount(0);
        await expect(pop.locator('.hd-who-person', { hasText: 'Nina Růžičková' }).locator('.hd-who-meta')).toHaveText('1845–1895 · Kutná Hora');
        // Escape closes it (the dialog stays).
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(modal(page)).toBeVisible();

        // From the menu's "Who sees it ›" too; a person: the card on the event's row.
        await eventMenu(page, 'E1');
        await page.locator('.hd-menu [data-scope="who"]').click();
        await expect(page.locator('.hd-menu .hd-who-title')).toHaveText('Seen on the card by 15 people');
        const nina = await idOf(page, 'Nina');
        await page.locator('.hd-menu [data-scope="whoMore"]').click();
        await page.locator(`.hd-menu [data-scope="see:${nina}"]`).click();
        await expect(modal(page)).toBeHidden();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row[data-history-id="E1"]')).toHaveClass(/is-flash/);
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row[data-history-id="E1"]')).not.toHaveClass(/is-flash/, { timeout: 4000 });
    });

    test('the event\'s menu: Hide at a place and for one person (search from 10 people), in the whole tree; Undo', async ({ page }) => {
        const { history } = await setup(page);
        await openDetail(page, 'cz-bohemia');
        expect(await eventMenu(page, 'E1')).toEqual(['who', 'hideTree', 'place', 'person', 'delete']);
        const menu = page.locator('.hd-menu');
        await expect(menu.locator('.pm-lifeline-hmenu-head')).toHaveText('1866 · Austro-Prussian War; fighting around Čáslav.');
        await expect(menu.locator('[data-scope="place"] .pm-lifeline-hmenu-hint')).toHaveText('choose from 2 places');
        await expect(menu.locator('[data-scope="person"] .pm-lifeline-hmenu-hint')).toHaveText('choose from 15 people');
        await expect(menu.locator('[data-scope="delete"]')).toHaveClass(/is-danger/);

        // At a place: the places by people; Escape goes back to the first level.
        await menu.locator('[data-scope="place"]').click();
        expect(await scopes(page, '.hd-menu')).toEqual(['back', 'p:Čáslav', 'p:Kutná Hora']);
        await expect(menu.locator('[data-scope="p:Čáslav"] .pm-lifeline-hmenu-hint')).toHaveText('13 people');
        await page.keyboard.press('Escape');
        expect(await scopes(page, '.hd-menu')).toEqual(['who', 'hideTree', 'place', 'person', 'delete']);
        await menu.locator('[data-scope="place"]').click();
        await menu.locator('[data-scope="p:Kutná Hora"]').click();
        await expect(menu).toHaveCount(0);
        const hidden = toast(page, 'Event hidden for Kutná Hora.');
        await expect(hidden).toBeVisible();
        await expect.poll(() => history.hides).toEqual([{ event: 'E1', place: 'Kutná Hora' }]);
        await expect(ev(page, 'E1').locator('.hd-hide-note')).toContainText('Hidden at Kutná Hora');
        await expect(ev(page, 'E1').locator('.hd-sees')).toHaveText('13 people will see it');
        await hidden.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => history.hides.length).toBe(2);
        expect(history.hides[1]).toMatchObject({ event: 'E1', place: 'Kutná Hora', do: 'show' });
        await expect(ev(page, 'E1').locator('.hd-hide-note')).toHaveCount(0);

        // For one person: 15 people, so a search.
        await eventMenu(page, 'E1');
        await menu.locator('[data-scope="person"]').click();
        const search = menu.locator('input.hd-menu-search[data-menu="q"]');
        await expect(search).toBeFocused();
        await expect(menu.locator('[data-scope^="o:"]')).toHaveCount(15);
        await search.fill('ruzic');
        await expect(menu.locator('[data-scope^="o:"] .pm-lifeline-hmenu-label')).toHaveText(['Nina Růžičková']);
        await menu.locator('[data-scope^="o:"]').click();
        await expect(toast(page, 'Event hidden for Nina Růžičková only.')).toBeVisible();
        await expect.poll(() => history.hides.length).toBe(3);
        expect(history.hides[2]).toMatchObject({ event: 'E1' });
        expect(history.hides[2].place).toBeUndefined();
        await expect(ev(page, 'E1').locator('.hd-hide-note')).toContainText('Hidden for Nina Růžičková only');
        await expect(ev(page, 'E1').locator('.hd-sees')).toHaveText('14 people will see it');

        // In the whole tree: dimmed; the menu has no more hiding.
        await eventMenu(page, 'E13');
        await menu.locator('[data-scope="hideTree"]').click();
        await expect(toast(page, 'The event is hidden in the whole tree.')).toBeVisible();
        await expect.poll(() => history.hides.length).toBe(4);
        expect(history.hides[3]).toEqual({ event: 'E13', tree: true });
        await expect(ev(page, 'E13')).toHaveClass(/is-dim/);
        await expect(ev(page, 'E13').locator('.hd-hide-note')).toContainText('Hidden in the whole tree');
        expect(await eventMenu(page, 'E13')).toEqual(['delete']);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(ev(page, 'E13').locator('[data-hd="menu"]')).toBeFocused();
        await expect(modal(page)).toBeVisible();
    });

    test('gates: no "Hide in the whole tree" without history.hide.all, no Delete without history.delete', async ({ page }) => {
        const features = HISTORY_R1_FEATURES.filter(f => f !== 'history.hide.all' && f !== 'history.delete');
        const { bridge } = await setup(page, { features });
        await openDetail(page, 'cz-bohemia');
        expect(await eventMenu(page, 'E1')).toEqual(['who', 'place', 'person']);
        await expect(page.locator('.hd-menu .hd-menu-note')).toHaveCount(0);
        await page.keyboard.press('Escape');
        // Without any hiding: only "Who sees it"; nobody sees it: no "⋯" at all.
        bridge.features = HISTORY_R1_FEATURES.filter(f => !f.startsWith('history.hide') && f !== 'history.delete');
        await poll(page);
        await expect.poll(() => eventMenu(page, 'E1')).toEqual(['who']);
        await page.keyboard.press('Escape');
        await expect(ev(page, 'E10').locator('[data-hd="menu"]')).toHaveCount(0);
        // No hiding feature: a hidden event's sentence has no Undo.
        await expect(ev(page, 'E2').locator('.hd-hide-note')).toContainText('Hidden at Čáslav');
        await expect(ev(page, 'E2').locator('[data-hd="unhide"]')).toHaveCount(0);
    });

    test('delete (variant A): confirmed with Cancel first; Only hide; Delete moves it to Deleted, Undo restores it', async ({ page }) => {
        const { history } = await setup(page);
        await openDetail(page, 'cz-bohemia');
        const askDelete = async (id: string) => {
            await eventMenu(page, id);
            await page.locator('.hd-menu [data-scope="delete"]').click();
            await expect(confirmModal(page)).toBeVisible();
        };
        await askDelete('E13');
        await expect(page.locator('#confirm-title')).toHaveText('Delete event?');
        await expect(confirmModal(page).locator('.confirm-subtitle')).toHaveText('1880 · Emigration to America. · Bohemia');
        await expect(page.locator('#confirm-message')).toContainText(
            'The event is deleted from the history of Bohemia, so from all trees on this computer. The research will not record it again. A deleted event can be restored under Deleted.');
        await expect(page.locator('#confirm-buttons button')).toHaveText(['Cancel', 'Only hide in this tree', 'Delete']);
        await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
        // Enter cancels.
        await page.keyboard.press('Enter');
        await expect(confirmModal(page)).toBeHidden();
        await expect(modal(page)).toBeVisible();
        expect(history.writes.delete).toEqual([]);

        // Only hide: in the whole tree.
        await askDelete('E11');
        await confirmModal(page).getByRole('button', { name: 'Only hide in this tree' }).click();
        await expect(toast(page, 'The event is hidden in the whole tree.')).toBeVisible();
        await expect.poll(() => history.hides).toEqual([{ event: 'E11', tree: true }]);
        expect(history.writes.delete).toEqual([]);

        // Delete: the row goes, Undo restores it.
        await askDelete('E13');
        await confirmModal(page).getByRole('button', { name: 'Delete', exact: true }).click();
        const deleted = toast(page, 'The event is deleted from all trees on this computer.');
        await expect(deleted).toBeVisible();
        expect(history.writes.delete).toEqual([{ event: 'E13' }]);
        await expect(ev(page, 'E13')).toHaveCount(0);
        await expect(rows(page)).toHaveCount(6);
        await deleted.getByRole('button', { name: 'Undo' }).click();
        await expect(toast(page, 'The event is restored.')).toBeVisible();
        expect(history.writes.delete[1]).toEqual({ event: 'E13', do: 'restore' });
        await expect(ev(page, 'E13')).toHaveCount(1);
        await expect(modal(page).locator('.hm-detail-state')).toHaveText(/^Done · 7 events/);

        // Deleted again: on the Deleted tab, newest first.
        await askDelete('E13');
        await confirmModal(page).getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(ev(page, 'E13')).toHaveCount(0);
        await expect.poll(() => history.writes.delete.length).toBe(3);
        await modal(page).locator('.hm-back').click();
        await expect(page.locator('#hm-tab-deleted .hm-tab-count')).toHaveText('3');
        await page.locator('#hm-tab-deleted').click();
        await expect(modal(page).locator('.hm-deleted .hm-h-text').first()).toHaveText('Emigration to America.');

        // A local event: its own title and sentence.
        await modal(page).locator('#hm-tab-regions').click();
        await modal(page).locator('.hm-region[data-key="local"]').click();
        await askDelete('L0031');
        await expect(page.locator('#confirm-title')).toHaveText('Delete local event?');
        await expect(page.locator('#confirm-message')).toContainText('The event from research sources is deleted in this tree only. The source stays in the tree.');
        await confirmModal(page).locator('#confirm-cancel-btn').click();
        expect(history.writes.delete.length).toBe(3);
    });

    test('delete refused: busy under the row, gone (404) reads the history again, retracted on Undo', async ({ page }) => {
        const { history } = await setup(page);
        await openDetail(page, 'cz-bohemia');
        const remove = async (id: string) => {
            await eventMenu(page, id);
            await page.locator('.hd-menu [data-scope="delete"]').click();
            await confirmModal(page).getByRole('button', { name: 'Delete', exact: true }).click();
        };
        history.writeReply = { delete: { status: 503, body: { error: 'busy', code: 'research.busy' } } };
        await remove('E13');
        await expect(ev(page, 'E13').locator('.hd-ev-note')).toHaveText('The research is busy. It will work again shortly.');
        await expect(ev(page, 'E13')).not.toHaveClass(/is-busy/);
        await expect(rows(page)).toHaveCount(7);

        history.writeReply = { delete: { status: 404, body: { error: 'No such event.', code: 'history.event' } } };
        const reads = history.reads;
        await remove('E13');
        await expect(toast(page, 'The event is no longer in the history.')).toBeVisible();
        await expect.poll(() => history.reads).toBeGreaterThan(reads);
        // The busy sentence went with the new attempt.
        await expect(ev(page, 'E13').locator('.hd-ev-note')).toHaveCount(0);

        // Deleted, then the research's agent retracts it: Undo says so.
        history.writeReply = undefined;
        await remove('E13');
        const deleted = toast(page, 'The event is deleted from all trees on this computer.');
        await expect(deleted).toBeVisible();
        history.retracted = ['E13'];
        await deleted.getByRole('button', { name: 'Undo' }).click();
        await expect(toast(page, 'The research removed this event itself; it cannot be restored here.')).toBeVisible();
        await expect(ev(page, 'E13')).toHaveCount(0);
        expect(history.writes.delete.map(w => w.do ?? '')).toEqual(['', '', '', 'restore']);
    });

    test('without the bridge: hiding goes to the queue with its note; Delete is a sentence', async ({ page }) => {
        const { bridge, history } = await setup(page);
        bridge.down = true;
        await poll(page);
        await openDetail(page, 'cz-bohemia');
        expect(await eventMenu(page, 'E1')).toEqual(['who', 'hideTree', 'place', 'person']);
        const menu = page.locator('.hd-menu');
        await expect(menu.locator('[data-scope="hideTree"] .pm-lifeline-hmenu-hint')).toHaveText('at all places, also future ones · so far only in this browser');
        await expect(menu.locator('.hd-menu-note')).toHaveText('Deleting needs the research running.');
        await menu.locator('[data-scope="place"]').click();
        await menu.locator('[data-scope="p:Čáslav"]').click();
        await expect(toast(page, 'Event hidden for Čáslav.')).toBeVisible();
        await expect(ev(page, 'E1').locator('.hd-hide-note')).toContainText('Hidden at Čáslav · so far only in this browser');
        await expect(ev(page, 'E1').locator('.hd-sees')).toHaveText('2 people will see it');
        expect(history.hides).toEqual([]);
        // The bridge back: the queue is sent.
        bridge.down = false;
        await poll(page);
        await expect.poll(() => history.hides).toEqual([expect.objectContaining({ event: 'E1', place: 'Čáslav' })]);
    });
});
