import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The names in the "▸ siblings" and "▸ children" bubbles stand by birth
 * (T49), whatever the order of the children in the data: the year, the
 * month and the day where known, "about 1786" as 1786, those without a
 * birth date last. Invented family; the focus is a great-grandchild, so
 * the grandfather's children (John's siblings) are out of view.
 */

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);

/** The children of Frank and Martha in the data's order, and by birth. */
const DATA_ORDER: Array<[string, string | undefined]> = [
    ['vince', '1789'], ['george', '~1786'], ['nobody', undefined], ['kate', '1782'],
    ['mary', '1780-05-02'], ['john', '1776'], ['anne', '1780-01'], ['magda', '1774'],
];
const SIBLINGS_BY_BIRTH = ['Magda', 'Anne', 'Mary', 'Kate', 'George', 'Vince', 'Nobody'].map(n => `${n} Pine`);
const CHILDREN_BY_BIRTH = ['Magda', 'John', 'Anne', 'Mary', 'Kate', 'George', 'Vince', 'Nobody'].map(n => `${n} Pine`);

async function setup(page: Page): Promise<void> {
    await openApp(page);
    await page.evaluate(async (order) => {
        const P = (id: string, o: Record<string, unknown>) => ({ id, firstName: id[0].toUpperCase() + id.slice(1), lastName: 'Pine',
            gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
        const kids = order.map(([id]) => id);
        const persons: Record<string, unknown> = {
            frank: P('frank', { birthDate: '1745', partnerships: ['u0'], childIds: kids }),
            martha: P('martha', { gender: 'female', birthDate: '1750', partnerships: ['u0'], childIds: kids }),
            rose: P('rose', { gender: 'female', partnerships: ['u1'], childIds: ['son'] }),
            son: P('son', { birthDate: '1805', parentIds: ['john', 'rose'], partnerships: ['u2'], childIds: ['gus'] }),
            dora: P('dora', { gender: 'female', partnerships: ['u2'], childIds: ['gus'] }),
            gus: P('gus', { birthDate: '1830', parentIds: ['son', 'dora'] }),
        };
        for (const [id, birthDate] of order) {
            persons[id] = P(id, { gender: ['kate', 'mary', 'anne', 'magda', 'nobody'].includes(id) ? 'female' : 'male',
                parentIds: ['frank', 'martha'], ...(birthDate ? { birthDate } : {}),
                ...(id === 'john' ? { partnerships: ['u1'], childIds: ['son'] } : {}) });
        }
        const partnerships = {
            u0: { id: 'u0', person1Id: 'frank', person2Id: 'martha', childIds: kids, status: 'married', startDate: '1772' },
            u1: { id: 'u1', person1Id: 'john', person2Id: 'rose', childIds: ['son'], status: 'married', startDate: '1800' },
            u2: { id: 'u2', person1Id: 'son', person2Id: 'dora', childIds: ['gus'], status: 'married' },
        };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships } as never, 'Pine');
        await window.Strom.TreeRenderer.setFocus('gus' as never);
    }, DATA_ORDER);
    await expect(cardOf(page, 'john')).toBeVisible();
    await expect(cardOf(page, 'frank')).toBeVisible();
    await expect(cardOf(page, 'magda')).toHaveCount(0);
}

for (const width of [1440, 390]) {
    test(`the siblings' and the children's bubbles list the names by birth, no date last (${width} px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await setup(page);
        const siblings = cardOf(page, 'john').locator('.branch-tab.siblings-tab');
        await expect(siblings).toHaveCount(1);
        await expect(siblings.locator('.badge-tooltip-name')).toHaveText(SIBLINGS_BY_BIRTH);
        const children = cardOf(page, 'frank').locator('.branch-tab.children-tab');
        await expect(children).toHaveCount(1);
        await expect(children.locator('.badge-tooltip-name')).toHaveText(CHILDREN_BY_BIRTH.filter(n => n !== 'John Pine'));
        // Shown in place: the "▾ siblings" bubble keeps the birth order
        await siblings.click();
        await expect(cardOf(page, 'magda')).toBeVisible();
        await expect(cardOf(page, 'john').locator('.siblings-bubble .badge-tooltip-name')).toHaveText(SIBLINGS_BY_BIRTH);
    });
}
