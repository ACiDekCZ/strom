import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, SeedPerson } from './helpers.js';

/**
 * Same names in the person search (1113, §1): a row whose shown text (name,
 * birth year as the list writes it) repeats in the result gets one quiet
 * line under it with what tells it apart — years → ⚭ partner → parents →
 * place; a row with a name of its own looks as before. The accessible name
 * reads "{name}, {line}", so a screen reader hears what "…" cut off.
 * Invented people only.
 */

const PEOPLE: Record<string, SeedPerson> = {
    al1: { firstName: 'Alžběta', lastName: 'Fikcínová', gender: 'female', birthDate: '1852', parents: ['jk', 'ma'], partners: ['jm'] },
    al2: { firstName: 'Alžběta', lastName: 'Fikcínová', gender: 'female', birthDate: '1852', partners: ['vz'] },
    al3: { firstName: 'Alžběta', lastName: 'Fikcínová', gender: 'female', birthDate: '1879', deathDate: '1880', parents: ['jm', 'al1'] },
    al4: { firstName: 'Alžběta', lastName: 'Fikcínová', gender: 'female', parents: ['jn', 'mn'] },
    ak: { firstName: 'Alois', lastName: 'Fikcín', birthDate: '1849', deathDate: '1903' },
    an1: { firstName: 'Anna', lastName: 'Pokusná', gender: 'female', birthDate: '1861', deathDate: '1930', partners: ['mv'] },
    an2: { firstName: 'Anna', lastName: 'Pokusná', gender: 'female' },
    an3: { firstName: 'Anna', lastName: 'Pokusná', gender: 'female', events: [{ id: 'e1', type: 'residence', place: 'Dolní Smyšlenice' }] },
    jm: { firstName: 'Jan', lastName: 'Mlynařík' },
    vz: { firstName: 'Václav', lastName: 'Zkoušek' },
    jk: { firstName: 'Josef', lastName: 'Fikcín', partners: ['ma'] },
    ma: { firstName: 'Marie', lastName: 'Fikcínová', gender: 'female', partners: ['jk'] },
    jn: { firstName: 'Josef', lastName: 'Návrhář', partners: ['mn'] },
    mn: { firstName: 'Marie', lastName: 'Návrhářová', gender: 'female', partners: ['jn'] },
    mv: { firstName: 'Matěj', lastName: 'Vymyšlený', partners: ['k1'] },
    // Found by a detail ("chol"), both the same.
    k1: { firstName: 'Kateřina', lastName: 'Vymyšlená', gender: 'female', deathDate: '1866', deathPlace: 'Horní Smyšlenice', deathCause: 'cholera', partners: ['mv'] },
    k2: { firstName: 'Kateřina', lastName: 'Vymyšlená', gender: 'female', deathDate: '1866', deathPlace: 'Horní Smyšlenice', deathCause: 'cholera', parents: ['jn', 'mn'] },
};

const items = (page: Page) => page.locator('#toolbar-search-picker .person-picker-item');

/** Every row of the open list: its id, the line under it, the accessible name. */
function rows(page: Page) {
    return items(page).evaluateAll(els => els.map(el => ({
        id: el.getAttribute('data-id'),
        role: el.getAttribute('role'),
        dist: el.querySelector('.person-picker-dist')?.textContent?.trim() ?? null,
        label: el.getAttribute('aria-label'),
    })));
}

async function seed(page: Page): Promise<void> {
    await seedTree(page, PEOPLE, 'Fikcinovi', 'ak');
    await page.evaluate(() => window.Strom.UI.refreshSearch());
}

test.describe('person search: same names told apart', () => {
    test('desktop: the repeated rows have a line, the rows of their own none; the accessible name reads it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await seed(page);
        const input = page.locator('#toolbar-search-picker .person-picker-input');
        await input.fill('a');
        await expect(items(page).first()).toBeVisible();
        const list = await rows(page);
        const byId = Object.fromEntries(list.map(r => [r.id, r]));
        expect(list.length).toBe(Object.keys(PEOPLE).length);
        expect(list.every(r => r.role === 'option')).toBe(true);
        // The toolbar list writes the birth year after the name: the two
        // "Alžběta Fikcínová (*1852)" repeat, told apart by the partner.
        expect(byId.al1.dist).toBe('⚭ Jan Mlynařík');
        expect(byId.al2.dist).toBe('⚭ Václav Zkoušek');
        // The two "Anna Pokusná" without a year: one has nothing known, the other a residence.
        expect(byId.an2.dist).toBe('no other details');
        expect(byId.an3.dist).toBe('lived in Dolní Smyšlenice');
        // Accessible name "{name}, {line}".
        expect(byId.al1.label).toBe('Alžběta Fikcínová (*1852), ⚭ Jan Mlynařík');
        expect(byId.an3.label).toBe('Anna Pokusná, lived in Dolní Smyšlenice');
        // Rows with a name of their own (also "Alžběta Fikcínová (*1879)") look as before.
        for (const id of ['al3', 'al4', 'ak', 'an1', 'jm', 'vz', 'jk', 'ma', 'jn', 'mn', 'mv']) {
            expect(byId[id].dist, id).toBeNull();
            expect(byId[id].label, id).toBeNull();
        }
        // A row with the line keeps at least 46px; the line never widens the list.
        const h = await items(page).filter({ has: page.locator('.person-picker-dist') }).first().evaluate(el => el.getBoundingClientRect().height);
        expect(h).toBeGreaterThanOrEqual(46);
        // Keyboard as before: ArrowDown marks the first row.
        await input.press('ArrowDown');
        await expect(items(page).first()).toHaveAttribute('aria-selected', 'true');

        // Found by a detail with the same name: one row, the line then the find
        // († 1866 not said twice), the searched text still marked.
        await input.fill('chol');
        await expect(items(page)).toHaveCount(2);
        const found = await rows(page);
        const k = Object.fromEntries(found.map(r => [r.id, r]));
        expect(k.k1.dist).toBe('⚭ Matěj Vymyšlený · † 1866 Horní Smyšlenice · cholera');
        expect(k.k2.dist).toBe('daughter of Josef Návrhář and Marie Návrhářová · † 1866 Horní Smyšlenice · cholera');
        await expect(items(page).locator('.person-picker-dist mark')).toHaveCount(2);
        // Never two rows under the name.
        await expect(items(page).locator('div.person-picker-match')).toHaveCount(0);
        expect(k.k1.label).toBe('Kateřina Vymyšlená, ⚭ Matěj Vymyšlený · † 1866 Horní Smyšlenice · cholera');
    });

});

test.describe('person search: same names on a phone', () => {
    test.use({ locale: 'de-DE', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('phone 390px in German: the line is cut with "…", no sideways scroll', async ({ page }) => {
        await openApp(page);
        await seedTree(page, {
            ...PEOPLE,
            al1: { ...PEOPLE.al1, partners: [], parents: ['jkl', 'mal'] },
            al2: { ...PEOPLE.al2, partners: [], parents: ['jn', 'mn'] },
            jkl: { firstName: 'Josef Maximilian', lastName: 'Fikcín-Návrhář', partners: ['mal'] },
            mal: { firstName: 'Marie Magdalena', lastName: 'Fikcínová-Návrhářová', gender: 'female', partners: ['jkl'] },
        }, 'Fikcinovi', 'ak');
        await page.evaluate(() => window.Strom.UI.refreshSearch());
        await page.locator('#search-open-btn').click();
        const input = page.locator('#toolbar-search-picker .person-picker-input');
        await input.fill('a');
        await expect(items(page).first()).toBeVisible();
        const list = await rows(page);
        const byId = Object.fromEntries(list.map(r => [r.id, r]));
        expect(byId.al1.dist).toBe('Tochter von Josef Maximilian Fikcín-Návrhář und Marie Magdalena Fikcínová-Návrhářová');
        expect(byId.an2.dist).toBe('keine weiteren Angaben');
        const fit = await page.evaluate(() => {
            const dd = document.querySelector('#toolbar-search-picker .person-picker-dropdown') as HTMLElement;
            const r = dd.getBoundingClientRect();
            const line = document.querySelector('#toolbar-search-picker .person-picker-item[data-id="al1"] .person-picker-dist') as HTMLElement;
            const row = line.closest('.person-picker-item') as HTMLElement;
            return {
                pageScroll: document.documentElement.scrollWidth, inner: window.innerWidth,
                left: r.left, right: r.right, ddScroll: dd.scrollWidth, ddClient: dd.clientWidth,
                cut: line.scrollWidth > line.clientWidth, ellipsis: getComputedStyle(line).textOverflow,
                rowH: row.getBoundingClientRect().height,
            };
        });
        expect(fit.pageScroll).toBeLessThanOrEqual(fit.inner);
        expect(fit.left).toBeGreaterThanOrEqual(0);
        expect(fit.right).toBeLessThanOrEqual(fit.inner);
        expect(fit.ddScroll).toBeLessThanOrEqual(fit.ddClient);
        expect(fit.cut).toBe(true);
        expect(fit.ellipsis).toBe('ellipsis');
        expect(fit.rowH).toBeGreaterThanOrEqual(56);
        // The whole line is in the accessible name.
        expect(byId.al1.label).toBe('Alžběta Fikcínová (*1852), Tochter von Josef Maximilian Fikcín-Návrhář und Marie Magdalena Fikcínová-Návrhářová');
    });
});

/**
 * Sisters of the same name and the same parents, apart only by the
 * birthplace (1113-app-sdilena-udalost): the parents, the same for both, are
 * left out of the line, so the birthplace is in its visible text and not cut
 * off behind long parents' names.
 */
const SISTERS: Record<string, SeedPerson> = {
    s1: { firstName: 'Alžběta Marie', lastName: 'Fikcínová-Pokusná', gender: 'female', parents: ['fa', 'mo'], birthPlace: 'Dolní Smyšlenice' },
    s2: { firstName: 'Alžběta Marie', lastName: 'Fikcínová-Pokusná', gender: 'female', parents: ['fa', 'mo'], birthPlace: 'Horní Smyšlenice' },
    fa: { firstName: 'Maximilián Bartoloměj', lastName: 'Hrubohorský-Zvěřinovský', partners: ['mo'] },
    mo: { firstName: 'Alžběta', lastName: 'Hrubohorská-Zvěřinovská', gender: 'female', partners: ['fa'] },
};

for (const [locale, born] of [['de-DE', 'Geburtsort'], ['cs-CZ', 'rodiště']] as const) {
    test.describe(`person search: sisters told apart by the birthplace (${locale})`, () => {
        test.use({ locale, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test(`phone 390px: the visible line is the birthplace, not the shared parents (${locale})`, async ({ page }) => {
            await openApp(page);
            await seedTree(page, SISTERS, 'Fikcinovi', 'fa');
            await page.evaluate(() => window.Strom.UI.refreshSearch());
            await page.locator('#search-open-btn').click();
            await page.locator('#toolbar-search-picker .person-picker-input').fill('alž');
            await expect(items(page).first()).toBeVisible();
            const shown = await items(page).evaluateAll(els => els.map(el => {
                const line = el.querySelector('.person-picker-dist') as HTMLElement | null;
                return {
                    id: el.getAttribute('data-id'),
                    dist: line?.textContent?.trim() ?? null,
                    cut: line ? line.scrollWidth > line.clientWidth : false,
                };
            }));
            const byId = Object.fromEntries(shown.map(r => [r.id, r]));
            for (const [id, place] of [['s1', 'Dolní Smyšlenice'], ['s2', 'Horní Smyšlenice']]) {
                expect(byId[id].dist, id).toBe(`${born} ${place}`);
                // The whole line is visible, nothing behind "…".
                expect(byId[id].cut, id).toBe(false);
            }
            // The mother has a name of her own: no line.
            expect(byId.mo.dist).toBeNull();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        });
    });
}
