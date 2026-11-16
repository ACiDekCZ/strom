/**
 * The Table's rows under group headers (spec 084 §10, §11): Group by › in the
 * Table's ⋯ (the phone's Group by › page), the headers with their counts,
 * a group closed by a click and the arrows, Collapse / Expand all groups,
 * the status line and the chip "Grouped: …" with its ×, a jump into a closed
 * group opening it, the phone's held header, and a union's partner outside
 * the list in grey. Invented names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

async function family(page: Page, extra = 0): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    const kids: Record<string, { firstName: string; lastName: string; parents: string[]; birthDate: string }> = {};
    for (let n = 0; n < extra; n++) kids[`k${n}`] = { firstName: `Orvel${n}`, lastName: 'Tamberlin', parents: ['t', 'i'], birthDate: String(1955 + n) };
    await seedTree(page, {
        q: { firstName: 'Quillon', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1950' },
        t: { firstName: 'Tamsel', lastName: 'Varnholm', parents: ['c', 'y'], partners: ['i'], birthDate: '1921' },
        i: { firstName: 'Ilvara', lastName: 'Brannoc', gender: 'female', partners: ['t'], birthDate: '1925' },
        c: { firstName: 'Corvin', lastName: 'Varnholm', partners: ['y'], birthDate: '1890' },
        y: { firstName: 'Yselda', lastName: 'Fennick', gender: 'female', partners: ['c'], birthDate: '1894' },
        w: { firstName: 'Wendrel', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1953' },
        ...kids,
    }, 'Varnholm', 'q');
    await page.evaluate(() => {
        window.Strom.DataManager.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['w', 'q', 't'] as never[], sort: 'manual' });
    });
}

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const tvItem = (page: Page, label: string | RegExp) => page.locator('.tv-menu .tv-menu-item', { hasText: label });
const status = (page: Page) => tv(page, '.tv-status-count');
const heads = (page: Page) => tv(page, '.tv-body .tv-row.tv-grp');
const head = (page: Page, label: string) => heads(page).filter({ has: page.locator('.tv-grp-label', { hasText: label }) });
const shownKeys = (page: Page) => tv(page, '.tv-body .tv-row[data-key]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key!));

test.describe('Table groups: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Group by › Surname: headers in order with counts, closed by a click and the arrows, all at once, the chip ends it', async ({ page }) => {
        await family(page);
        await page.locator('#view-mode-table').click();
        await expect(status(page)).toHaveText('6 of 6 people');
        await tv(page, '.tv-more-menu-btn').click();
        const groupBy = tvItem(page, 'Group by');
        await expect(groupBy).toBeVisible();
        await expect(tvItem(page, 'Collapse all groups')).toBeDisabled();
        await groupBy.click();
        await expect(tvItem(page, 'No grouping')).toHaveAttribute('aria-checked', 'true');
        await tvItem(page, /^Surname$/).click();

        await expect(heads(page).locator('.tv-grp-label')).toHaveText(['Brannoc', 'Fennick', 'Varnholm']);
        await expect(head(page, 'Varnholm').locator('.tv-grp-nw')).toHaveText('4 people');
        await expect(head(page, 'Varnholm')).toHaveAttribute('aria-expanded', 'true');
        expect((await head(page, 'Varnholm').boundingBox())!.height).toBe(34);
        await expect(status(page)).toHaveText('6 of 6 people · 3 groups');
        await expect(tv(page, '.tv-grpchip')).toContainText('Grouped: Surname');

        // A click closes the group; → opens it again, ← closes it.
        await head(page, 'Varnholm').click();
        await expect(head(page, 'Varnholm')).toHaveAttribute('aria-expanded', 'false');
        expect(await shownKeys(page)).not.toContain('p:q');
        await head(page, 'Varnholm').locator('.tv-grp-cell').focus();
        await page.keyboard.press('ArrowRight');
        await expect(head(page, 'Varnholm')).toHaveAttribute('aria-expanded', 'true');
        expect(await shownKeys(page)).toContain('p:q');
        await page.keyboard.press('ArrowLeft');
        await expect(head(page, 'Varnholm')).toHaveAttribute('aria-expanded', 'false');

        // A jump to a person in a closed group opens it.
        await page.evaluate(() => window.Strom.UI.tableRunJump({ from: null, to: { personId: 'q', key: 'p:q', col: 'name', origin: null } } as never, false, false));
        await expect(head(page, 'Varnholm')).toHaveAttribute('aria-expanded', 'true');
        await expect(tv(page, '.tv-body .tv-row[data-key="p:q"]')).toBeVisible();

        // ⋯: Collapse all groups, then Expand all groups.
        await tv(page, '.tv-more-menu-btn').click();
        await expect(tvItem(page, 'Group by')).toContainText('Surname');
        await tvItem(page, 'Collapse all groups').click();
        await expect(heads(page).filter({ has: page.locator('[aria-expanded="true"]') })).toHaveCount(0);
        expect(await shownKeys(page)).toEqual(['g:Brannoc', 'g:Fennick', 'g:Varnholm']);
        await tv(page, '.tv-more-menu-btn').click();
        await tvItem(page, 'Expand all groups').click();
        expect((await shownKeys(page)).length).toBe(9);

        // Another row type keeps its own grouping; back on People the grouping is there.
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        await expect(heads(page)).toHaveCount(0);
        await tv(page, '.tv-rowtype [data-rowtype="persons"]').click();
        await expect(heads(page)).toHaveCount(3);

        // The chip's × ends the grouping.
        await tv(page, '.tv-grpchip-x').click();
        await expect(heads(page)).toHaveCount(0);
        await expect(status(page)).toHaveText('6 of 6 people');
        await expect(tv(page, '.tv-grpchip')).toHaveCount(0);
    });

    test('Unions in a list\'s scope: the partner outside the list in grey, grouped by the number of children', async ({ page }) => {
        await family(page);
        await page.locator('#view-mode-table').click();
        await tv(page, '.tv-scope-btn').click();
        await tvItem(page, 'Letters to write').click();
        await tv(page, '.tv-rowtype [data-rowtype="unions"]').click();
        await expect(status(page)).toHaveText(/^1 of 1 union/);
        const off = tv(page, '.tv-body .tv-cell.is-off-list');
        await expect(off).toHaveCount(1);
        await expect(off).toContainText('Ilvara');
        await expect(off).toHaveAttribute('title', /outside the list/);
        await tv(page, '.tv-more-menu-btn').click();
        await tvItem(page, 'Group by').click();
        await expect(page.locator('.tv-menu .tv-menu-item')).toHaveText([/No grouping$/, 'Decade of marriage', 'Place of marriage', 'Partners’ family lines', 'Number of children']);
        await tvItem(page, 'Number of children').click();
        await expect(heads(page).locator('.tv-grp-label')).toHaveText(['2 children']);
        await expect(status(page)).toHaveText(/^1 of 1 union · 1 group$/);
    });
});

test.describe('Table groups: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Group by › in ⋯: a page of choices, 40 px headers with the number, the header held at the top while its rows scroll', async ({ page }) => {
        await family(page, 30);
        await page.locator('#bb-view-table').tap();
        await expect(status(page)).toHaveText('36 of 36 people');
        await tv(page, '.tv-more-menu-btn').tap();
        const sheet = page.locator('.bottom-sheet');
        const row = sheet.locator('.bottom-sheet-item', { hasText: 'Group by' });
        await expect(row).toContainText('No grouping');
        await row.tap();
        const sub = sheet.locator('.bottom-sheet-subpage');
        const item = sub.locator('.bottom-sheet-item', { hasText: /^Surname/ });
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await item.tap();
        // The rows are drawn as they come into view: Varnholm's header is further down.
        await expect(heads(page).locator('.tv-grp-label')).toHaveText(['Brannoc', 'Fennick', 'Tamberlin']);
        const tam = head(page, 'Tamberlin');
        expect((await tam.boundingBox())!.height).toBe(40);
        await expect(tam.locator('.tv-grp-nn')).toHaveText('30');
        await expect(tam.locator('.tv-grp-nw')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        // Scrolled into Tamberlin's rows: its header is held under the table's head; a tap closes the group.
        const stuck = tv(page, '.tv-grp-stuck');
        await expect(stuck).toHaveCount(0);
        await tv(page, '.tv-grid, .table-grid').first().evaluate(el => { el.scrollTop = 400; });
        await expect(stuck.locator('.tv-grp-label')).toHaveText('Tamberlin');
        await stuck.tap();
        await expect(tam).toHaveAttribute('aria-expanded', 'false');
    });
});
