import { test, expect, Page } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The People table's citation columns and Godparents (spec 073 §14.3,
 * §14.5): switched on in the Columns panel; the first cited source's
 * reference with a pill "+2" whose bubble lists the other sources, a click
 * opens one in the sources manager; a marriage's citations on each union's
 * sub-row; the godparents with the tree's person as a link that opens the
 * person. On a phone the pill opens a sheet with 44 px rows.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    a: person('a', 'Radoslav', 'Pecháček', {
        birthDate: '1840-04-03', deathDate: '1901-02-11', partnerships: ['u1', 'u2'], childIds: ['c'],
        birthSourceIds: ['s1', 's2'], events: [{ id: 'ab', type: 'baptism', date: '1840-04-04', sourceIds: ['s3'] }],
    }),
    b: person('b', 'Ludmila', 'Hruštičková', { gender: 'female', birthDate: '1845', deathDate: '1870', partnerships: ['u1'], childIds: ['c'] }),
    w: person('w', 'Johana', 'Vrbatová', { gender: 'female', birthDate: '1850', deathDate: '1910', partnerships: ['u2'] }),
    c: person('c', 'Kvirin', 'Pecháček', {
        birthDate: '1866-08-01', parentIds: ['a', 'b'], refn: 'K-3/1866',
        events: [{
            id: 'cb', type: 'baptism', date: '1866-08-02',
            participants: [{ id: 'g1', role: 'godparent', personId: 'g' }, { id: 'g2', role: 'godparent', name: 'Drahobud Vlčírek' }],
        }],
    }),
    g: person('g', 'Ostromír', 'Plíšťák', { birthDate: '1830', deathDate: '1899' }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', startDate: '1865-01-20', sourceIds: ['s3', 's2'] },
    u2: { id: 'u2', person1Id: 'a', person2Id: 'w', childIds: [], status: 'married', startDate: '1872-02-03', sourceIds: ['s4'] },
};
const SOURCES = {
    s1: { id: 's1', title: 'Kniha narozených Lhota pod Skalkou', repository: 'Archiv Smyšlený', reference: 'fol. 7', url: 'https://example.org/lhota/7' },
    s2: { id: 's2', title: 'Výpis ze soupisu', reference: 'č. 41' },
    s3: { id: 's3', title: 'Oddací kniha Lhota pod Skalkou', repository: 'Farní úřad Lhota', reference: 'fol. 30' },
    s4: { id: 's4', title: 'Kniha zemřelých Lhota pod Skalkou', reference: 'fol. 99', url: 'www.example.org/zemreli/99' },
};

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

/** Two frames: a scroll's event has fired. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function openTable(page: Page, phone: boolean): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Pecháček');
        await window.Strom.TreeRenderer.setFocus('c' as never);
    }, { persons: PERSONS, partnerships: PARTNERSHIPS, sources: SOURCES });
    await expect(card(page, 'Kvirin')).toBeVisible();
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Table' }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(tv(page, '.tv-status-count')).toHaveText('5 of 5 people');
}

/** Switch columns on in the Columns panel (a sheet on a phone) by their names. */
async function showColumns(page: Page, phone: boolean, names: string[]): Promise<void> {
    if (phone) {
        await tv(page, '.tv-more-menu-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Columns' }).tap();
    } else {
        await tv(page, '.tv-cols-btn').click();
    }
    const panel = page.getByRole('dialog', { name: 'Columns' });
    await expect(panel).toBeVisible();
    for (const name of names) {
        await page.locator('.tv-cp-q').fill(name);
        await panel.getByRole('checkbox', { name, exact: true }).check();
    }
    await page.locator('.tv-cp-q').fill('');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(panel).toHaveCount(0);
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the citation columns and Godparents from the Columns panel; "+2" opens its bubble, a click opens the source', async ({ page }) => {
        await openTable(page, false);
        await showColumns(page, false, ['Birth: other location', 'Marriage: other location', 'Godparents']);

        // The first citation's reference and the pill of the other two.
        const ref = await cell(page, 'p:a', 'bRef');
        await expect(ref.locator('.tv-cell-text')).toHaveText('fol. 7');
        const pill = ref.locator('.tv-cites-more');
        await expect(pill).toHaveText('+2');
        await expect(pill).toHaveAttribute('aria-label', '2 more citations');
        // One citation: no pill; none: empty.
        await expect((await cell(page, 'p:b', 'bRef')).locator('.tv-cites-more')).toHaveCount(0);

        // A marriage's citations on each union's sub-row.
        await expect((await cell(page, 'p:a#u1', 'wRef')).locator('.tv-cell-text')).toHaveText('fol. 30');
        await expect((await cell(page, 'p:a#u1', 'wRef')).locator('.tv-cites-more')).toHaveText('+1');
        await expect((await cell(page, 'p:a#u2', 'wRef')).locator('.tv-cell-text')).toHaveText('fol. 99');
        await expect((await cell(page, 'p:a#u2', 'wRef')).locator('.tv-cites-more')).toHaveCount(0);

        // The bubble: the other sources; Escape closes it, the focus back on the pill. The grid's
        // scroll closes a bubble: the pill brought into view first, its scroll settled.
        await pill.scrollIntoViewIfNeeded();
        await settle(page);
        await pill.click();
        const bubble = page.getByRole('dialog', { name: 'Other citations' });
        await expect(bubble).toBeVisible();
        const items = bubble.locator('.tv-bub-cite');
        await expect(items.locator('.tv-bub-cite-title')).toHaveText(['Výpis ze soupisu', 'Oddací kniha Lhota pod Skalkou']);
        await expect(items.nth(1).locator('.tv-bub-cite-meta')).toHaveText('Farní úřad Lhota · fol. 30');
        await expect(items.first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(bubble).toHaveCount(0);
        await expect(pill).toBeFocused();

        // A click on a source opens it in the sources manager.
        await pill.click();
        await bubble.locator('.tv-bub-cite').nth(1).click();
        const modal = page.locator('#sources-modal');
        await expect(modal).toHaveClass(/active/);
        await expect(modal.locator('.source-row.is-target .source-title')).toHaveText('Oddací kniha Lhota pod Skalkou');
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);

        // Godparents: the tree's person a link that opens the person, a written name text.
        const gods = await cell(page, 'p:c', 'godparents');
        await expect(gods).toContainText('Ostromír Plíšťák, Drahobud Vlčírek');
        await expect(gods.locator('.tv-nm--person')).toHaveText('Ostromír Plíšťák');
        await gods.locator('.tv-nm--person').click();
        await expect(page.locator('#person-page-modal')).toBeVisible();
        await expect(page.locator('#person-page-modal')).toContainText('Ostromír Plíšťák');
    });
});

test.describe('desktop (1440): the URL columns (T54)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('"<Event>: URL" columns; a web address with or without "https://" opens a new tab, the row\'s selection stays', async ({ page }) => {
        // The archive's pages are not fetched: the new tab gets a blank page.
        await page.context().route(/example\.org/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));
        await openTable(page, false);
        await showColumns(page, false, ['Birth: URL', 'Marriage: URL', 'Ref. number (REFN)']);
        await expect(tv(page, '.tv-headrow [data-col="bUrl"]')).toContainText('Birth: URL');

        // A person selected by a click on a cell.
        // The reference number as written (REFN, offered in the Person group).
        await expect((await cell(page, 'p:c', 'refn')).locator('.tv-cell-text')).toHaveText('K-3/1866');
        await (await cell(page, 'p:c', 'refn')).click();
        await expect(tv(page, '.tv-body .tv-row[data-key="p:c"]')).toHaveAttribute('aria-selected', 'true');

        const birth = (await cell(page, 'p:a', 'bUrl')).locator('a.tv-link');
        await expect(birth).toHaveAttribute('href', 'https://example.org/lhota/7');
        await expect(birth).toHaveAttribute('target', '_blank');
        await expect(birth).toHaveAttribute('rel', 'noopener noreferrer');
        const [tab] = await Promise.all([page.waitForEvent('popup'), birth.click()]);
        await expect.poll(() => tab.url()).toBe('https://example.org/lhota/7');
        await tab.close();
        await expect(tv(page, '.tv-body .tv-row[data-key="p:a"]')).toHaveAttribute('aria-selected', 'false');
        await expect(tv(page, '.tv-body .tv-row[data-key="p:c"]')).toHaveAttribute('aria-selected', 'true');

        // Written without the scheme (the second marriage's source): https, on the union's sub-row.
        const marriage = (await cell(page, 'p:a#u2', 'wUrl')).locator('a.tv-link');
        await expect(marriage).toHaveAttribute('href', 'https://www.example.org/zemreli/99');
        await expect(marriage).toContainText('example.org/zemreli/99');
        const [tab2] = await Promise.all([page.waitForEvent('popup'), marriage.click()]);
        await expect.poll(() => tab2.url()).toBe('https://www.example.org/zemreli/99');
        await tab2.close();
        await expect(tv(page, '.tv-body .tv-row[data-key="p:a"]')).toHaveAttribute('aria-selected', 'false');
        await expect(tv(page, '.tv-body .tv-row[data-key="p:c"]')).toHaveAttribute('aria-selected', 'true');
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the pill opens a sheet of the other sources; a tap opens the source; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await showColumns(page, true, ['Birth: other location']);
        const ref = await cell(page, 'p:a', 'bRef');
        const pill = ref.locator('.tv-cites-more');
        await pill.scrollIntoViewIfNeeded();
        await expect(pill).toHaveText('+2');
        await pill.tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Other citations');
        const items = sheet.locator('.bottom-sheet-item');
        await expect(items).toHaveCount(2);
        // Each source's title with its archive and reference under it.
        await expect(items.first().locator('.bottom-sheet-label')).toContainText('Výpis ze soupisu');
        await expect(items.first()).toContainText('č. 41');
        await expect(items.nth(1).locator('.bottom-sheet-label')).toContainText('Oddací kniha Lhota pod Skalkou');
        await expect(items.nth(1)).toContainText('Farní úřad Lhota · fol. 30');
        expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await items.first().tap();
        const modal = page.locator('#sources-modal');
        await expect(modal).toHaveClass(/active/);
        await expect(modal.locator('.source-row.is-target .source-title')).toHaveText('Výpis ze soupisu');
        await page.keyboard.press('Escape');

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});

test.describe('phone held sideways (844 × 390)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the pill\'s sheet fits the low screen; its rows are 44 px; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await showColumns(page, true, ['Birth: other location']);
        const pill = (await cell(page, 'p:a', 'bRef')).locator('.tv-cites-more');
        await pill.scrollIntoViewIfNeeded();
        await settle(page);
        await pill.tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toContainText('Other citations');
        const items = sheet.locator('.bottom-sheet-item');
        await expect(items).toHaveCount(2);
        for (const i of [0, 1]) {
            await items.nth(i).scrollIntoViewIfNeeded();
            const b = (await items.nth(i).boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(44);
            expect(b.y + b.height).toBeLessThanOrEqual(390);
            expect(b.x + b.width).toBeLessThanOrEqual(844);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
});
