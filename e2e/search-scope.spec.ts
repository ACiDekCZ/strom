import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card, SeedPerson } from './helpers.js';

/**
 * The search scope (spec 137 §1–§5): the results' head of the person search
 * has Whole tree / Direct line / In view; the direct line is the reference
 * person with ancestors and descendants (no partners, no in-laws); a scope
 * with nobody in it offers the whole tree; the toolbar's highlight and the
 * filter counts narrow with it, the funnel's badge does not; the phone has
 * the head over the full width, 44 px segments, and the filter sheet only a
 * quiet line. Invented people only.
 */

const PEOPLE: Record<string, SeedPerson> = {
    jan: { firstName: 'Jan', lastName: 'Vymyšlenský', birthDate: '1871', parents: ['karel', 'anna'], partners: ['marie'] },
    karel: { firstName: 'Karel', lastName: 'Vymyšlenský', birthDate: '1845', parents: ['bohumil', 'ludmila'], partners: ['anna'] },
    anna: { firstName: 'Anna', lastName: 'Pokusová', gender: 'female', birthDate: '1848', partners: ['karel'] },
    bohumil: { firstName: 'Bohumil', lastName: 'Vymyšlenský', birthDate: '1820', partners: ['ludmila'] },
    ludmila: { firstName: 'Ludmila', lastName: 'Vymyšlenská', gender: 'female', birthDate: '1822', partners: ['bohumil'] },
    vaclav: { firstName: 'Václav', lastName: 'Vymyšlenský', birthDate: '1874', parents: ['karel', 'anna'] },
    marie: { firstName: 'Marie', lastName: 'Nevšední', gender: 'female', birthDate: '1873', parents: ['josef'], partners: ['jan'] },
    josef: { firstName: 'Josef', lastName: 'Nevšední', birthDate: '1840' },
    petr: { firstName: 'Petr', lastName: 'Vymyšlenský', birthDate: '1898', parents: ['jan', 'marie'] },
};
/** "Vymyšlen" finds six; five of them are Jan's direct line (Václav, the brother, is not). */
const QUERY = 'Vymyšlen';

const picker = (page: Page, root = '#toolbar-search-picker') => ({
    input: page.locator(`${root} .person-picker-input`),
    dropdown: page.locator(`${root} .person-picker-dropdown`),
    items: page.locator(`${root} .person-picker-item`),
    segments: page.locator(`${root} .person-picker-scope [data-scope]:not([hidden])`),
    segment: (s: string) => page.locator(`${root} .person-picker-scope [data-scope="${s}"]`),
    count: page.locator(`${root} .person-picker-head-row .person-picker-count`),
    ref: page.locator(`${root} .person-picker-ref`),
    empty: page.locator(`${root} .person-picker-narrow-empty`),
    whole: page.locator(`${root} .person-picker-whole`),
});

async function seed(page: Page): Promise<void> {
    await seedTree(page, PEOPLE, 'Vymyslensti', 'jan');
    await page.evaluate(() => window.Strom.UI.refreshSearch());
}

/** The matches of the query among the people the tree view shows now. */
function shownMatches(page: Page): Promise<number> {
    return page.evaluate(() => [...window.Strom.TreeRenderer.getVisiblePersonIds()]
        .filter(id => window.Strom.DataManager.getPerson(id)?.lastName.startsWith('Vymyšlen')).length);
}

test.describe('search scope: desktop', () => {
    for (const scheme of ['light', 'dark'] as const) {
        test(`toolbar (${scheme}): Whole tree → Direct line → In view narrows the list, the count and the highlight`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.emulateMedia({ colorScheme: scheme });
            await openApp(page);
            await seed(page);
            const p = picker(page);
            await p.input.fill(QUERY);
            await expect(p.items).toHaveCount(6);
            await expect(p.segments).toHaveCount(3);
            await expect(p.segment('tree')).toHaveAttribute('aria-checked', 'true');
            await expect(p.count).toHaveText('6 people');
            await expect(card(page, 'Václav')).toHaveClass(/search-hit/);

            // A press on a segment keeps the field's focus (the keyboard stays).
            await p.segment('line').click();
            await expect(p.input).toBeFocused();
            await expect(p.segment('line')).toHaveAttribute('aria-checked', 'true');
            await expect(p.items).toHaveCount(5);
            await expect(p.count).toHaveText('5 people');
            await expect(p.ref).toContainText('Direct line: Jan Vymyšlenský (*1871)');
            await expect(p.items.filter({ hasText: 'Václav' })).toHaveCount(0);
            // The highlight narrows too: the brother is no hit, Jan is.
            await expect(card(page, 'Jan')).toHaveClass(/search-hit/);
            await expect(card(page, 'Václav')).not.toHaveClass(/search-hit/);

            await p.segment('view').click();
            const inView = await shownMatches(page);
            await expect(p.items).toHaveCount(inView);
            await expect(p.ref).toContainText('In view: Family');

            // Alt+← steps back without leaving the field.
            await p.input.press('Alt+ArrowLeft');
            await expect(p.segment('line')).toHaveAttribute('aria-checked', 'true');

            // Nothing overflows the page.
            expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        });
    }

    test('nobody in the direct line offers the whole tree; the scope is not a filter', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await seed(page);
        const p = picker(page);
        await p.input.fill(QUERY);
        await p.segment('line').click();
        // Josef is Marie's father: an in-law, not Jan's line.
        await p.input.fill('Josef');
        await expect(p.empty).toHaveText(/Nobody in the direct line\. 1 match in the whole tree\./);
        await expect(p.items).toHaveCount(0);
        await p.input.press('Enter');
        await expect(p.segment('tree')).toHaveAttribute('aria-checked', 'true');
        await expect(p.items).toHaveCount(1);

        // Back to the line; the button does the same as Enter.
        await p.segment('line').click();
        await expect(p.empty).toBeVisible();
        await p.whole.click();
        await expect(p.segment('tree')).toHaveAttribute('aria-checked', 'true');

        // With a filter: the count narrows and says so, the badge counts the filter alone.
        await p.segment('line').click();
        await p.input.fill('');
        await page.keyboard.press('Escape');
        await page.locator('#search-filter-toggle').click();
        await page.locator('#filter-lastname').fill(QUERY);
        await expect(page.locator('#search-result-count')).toHaveText('5 results · direct line only');
        await expect(page.locator('#search-filter-badge')).toHaveText('1');
        await expect(card(page, 'Václav')).not.toHaveClass(/search-hit/);
        await expect(card(page, 'Karel')).toHaveClass(/search-hit/);
        // Clear drops the filter, not the scope.
        await page.locator('#search-filters').getByRole('button', { name: 'Clear' }).click();
        await p.input.fill(QUERY);
        await expect(p.segment('line')).toHaveAttribute('aria-checked', 'true');
        await expect(p.items).toHaveCount(5);
    });

    test('Map: the line reads from the tree\'s main person; Table: In view is what the filtered table shows', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await seed(page);
        const p = picker(page);

        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('map' as never));
        await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'map');
        await p.input.fill(QUERY);
        await p.segment('line').click();
        await expect(p.ref).toContainText('the tree\'s main person');
        await expect(p.items).toHaveCount(5);
        await page.keyboard.press('Escape');

        await page.locator('#view-mode-table').click();
        await page.locator('#table-container .tv-search-q').fill('Petr');
        await expect(page.locator('#table-container .tv-status-count')).toHaveText('1 of 9 people');
        await p.input.fill(QUERY);
        await expect(p.segments).toHaveCount(3);
        await p.segment('view').click();
        await expect(p.items).toHaveCount(1);
        await expect(p.ref).toContainText('In view: Table, filtered · 1 person');
    });

    test('dialogs: linking a child offers three scopes, the relationship from the Person page two', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await seed(page);

        await card(page, 'Jan').click();
        await page.locator('.context-menu [data-action="child"]').filter({ visible: true }).click();
        const modal = page.locator('#relation-modal');
        await expect(modal).toBeVisible();
        await modal.locator('#toggle-link-mode').click();
        const rel = picker(page, '#existing-person-picker');
        await rel.input.fill('a');
        await expect(rel.segments).toHaveCount(3);
        await rel.segment('line').click();
        await expect(rel.ref).toContainText('Jan Vymyšlenský');
        await modal.locator('.close-btn').click();
        await expect(modal).toBeHidden();

        await page.evaluate(() => window.Strom.UI.showPersonPage('jan' as never));
        await page.evaluate(() => window.Strom.UI.showRelationshipCalculator('jan' as never));
        const kin = picker(page, '#kinship-modal');
        await kin.input.fill(QUERY);
        // The Person page covers the view: no In view; the chosen Direct line holds.
        await expect(kin.segments).toHaveCount(2);
        await expect(kin.segment('line')).toHaveAttribute('aria-checked', 'true');
    });
});

test.describe('search scope: phone', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        test(`${vp.width}×${vp.height}: 44 px segments over the results; the filter sheet only says the scope`, async ({ page }) => {
            await page.setViewportSize(vp);
            await openApp(page);
            await seed(page);
            const p = picker(page);
            const open = page.locator('#search-open-btn');
            if (await open.isVisible()) await open.tap();
            await p.input.fill(QUERY);
            await expect(p.segments).toHaveCount(3);
            for (const s of await p.segments.all()) expect(Math.round((await s.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
            const dd = (await p.dropdown.boundingBox())!;
            if (vp.width < vp.height) {
                expect(Math.round(dd.x)).toBe(8);
                expect(Math.round(dd.width)).toBe(vp.width - 16);
            } else {
                expect(dd.width).toBeLessThanOrEqual(440);
                expect(dd.x + dd.width).toBeLessThanOrEqual(vp.width);
            }
            await p.segment('line').tap();
            await expect(p.segment('line')).toHaveAttribute('aria-checked', 'true');
            await expect(p.ref).toContainText('5 people');
            expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

            await p.input.blur();
            await page.locator('#search-filter-toggle').tap();
            const sheet = page.locator('#search-filters');
            await expect(sheet).toBeVisible();
            await expect(sheet.locator('.person-picker-scope')).toHaveCount(0);
            await expect(page.locator('#search-filters-scope')).toHaveText('Searching the direct line only: Jan Vymyšlenský (*1871).');
        });
    }

    test('390×844, German: a very long name shortens with "…", its birth year stays whole in the row', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openApp(page);
        await seedTree(page, {
            ...PEOPLE,
            long: { firstName: 'Florentýn Servác Bonifác', lastName: 'Hrabětický-Ambrožík ze Žabokřik', birthDate: '1902', parents: ['petr'] },
        }, 'Vymyslensti', 'jan');
        await page.evaluate(() => {
            window.Strom.UI.setLanguage('de' as never);
            window.Strom.UI.refreshSearch();
        });
        const p = picker(page);
        const open = page.locator('#search-open-btn');
        if (await open.isVisible()) await open.tap();
        await p.input.fill('Florentýn');
        await expect(p.items).toHaveCount(1);
        await expect(p.items.first().locator('.birth-year')).toHaveText('(*1902)');
        // The list takes the screen's width (positioned after it opens): the name is cut, the year inside the row.
        await expect.poll(() => p.items.first().evaluate(row => {
            const r = row.getBoundingClientRect();
            const year = row.querySelector('.birth-year')!.getBoundingClientRect();
            const name = row.querySelector('.person-picker-name')!;
            const cut = [name, ...name.querySelectorAll('*')].some(el => el.scrollWidth > el.clientWidth);
            return { cut, yearInRow: year.left >= r.left && year.right <= r.right, rowInScreen: r.right <= window.innerWidth };
        })).toEqual({ cut: true, yearInRow: true, rowInScreen: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
});
