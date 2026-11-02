import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, HEAD, links } from './research-bridge.js';

/**
 * A place with its spellings in the Places dialog (spec 034 §4): one group
 * under today's name with its spellings, old names and houses tagged, a
 * spelling "On the map as" the place, the search finding the group by an old
 * name, Unify (the tree) with its preview, toast and Undo, Fix the entry in
 * the research (a research on this computer), one map point, and a phone.
 * Invented places and people (the Brindak family).
 */

/** The tree's place key (placeKey): no accents, lowercase, dots and commas as spaces. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();

const RECORD = {
    id: 'L0012',
    names: [{ name: 'Horní Lhota' }, { name: 'Ober-Lhota', lang: 'de', from: 1838, to: 1845 }],
};

const HORNI = { lat: 49.61, lon: 15.42 };
const LHOTA = { lat: 49.6, lon: 15.4 };

/**
 * The Brindak family: Horní Lhota written three ways (twice in full, once as
 * H. Lhota, once by its old German name) and one house of it; Lhota, Lhotov
 * and Lhoták are other places.
 */
async function ownTree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        a: { firstName: 'Zorbin', lastName: 'Brindak', birthDate: '1860', birthPlace: 'Horní Lhota', deathDate: '1878', deathPlace: 'Lhota' },
        b: { firstName: 'Quilla', lastName: 'Brindak', birthDate: '1865', birthPlace: 'Horní Lhota', deathDate: '1875', deathPlace: 'H. Lhota' },
        c: { firstName: 'Yarek', lastName: 'Brindak', birthDate: '1840', birthPlace: 'Ober-Lhota', deathDate: '1880', deathPlace: 'Lhotov' },
        d: { firstName: 'Orvel', lastName: 'Brindak', birthDate: '1868', birthPlace: 'Horní Lhota čp. 5' },
        e: { firstName: 'Myrtan', lastName: 'Brindak', birthDate: '1872', birthPlace: 'Lhoták' },
    } as never, 'Brindak');
    await page.evaluate(({ record, horni, lhota, refs }) => {
        const S = window.Strom;
        const data = S.DataManager.getData() as unknown as Record<string, unknown>;
        data.placeRecords = { L0012: record };
        data.placeRefs = refs;
        data.places = {
            'horni lhota': { ...horni, label: 'Horní Lhota' },
            lhota: { ...lhota, label: 'Lhota' },
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    }, {
        record: RECORD, horni: HORNI, lhota: LHOTA,
        refs: { [key('Horní Lhota')]: 'L0012', [key('H. Lhota')]: 'L0012', [key('Ober-Lhota')]: 'L0012' },
    });
}

const open = (page: Page): Promise<void> => page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
const modal = (page: Page): Locator => page.locator('#places-modal');
const group = (page: Page): Locator => modal(page).locator('.place-group.is-variant');
const sub = (page: Page, name: string): Locator => group(page).locator(`.place-row-sub[data-key="${key(name)}"]`);
const toast = (page: Page): Locator => page.locator('.toast').last();

async function openGroup(page: Page): Promise<void> {
    const caret = group(page).locator('.place-group-head .place-caret');
    if (await caret.getAttribute('aria-expanded') !== 'true') await caret.click();
    await expect(caret).toHaveAttribute('aria-expanded', 'true');
}

test.describe('a tree with a research record of a place', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await ownTree(page);
        await open(page);
        await expect(modal(page)).toBeVisible();
    });

    test('one group under today\'s name: spellings, an old name and a house tagged; other places stay apart', async ({ page }) => {
        await expect(group(page)).toHaveCount(1);
        const head = group(page).locator(':scope > .place-group-head');
        await expect(head.locator('.place-title').first()).toHaveText('Horní Lhota');
        await expect(head).toContainText('2 spellings · 1 house · 5 facts · 4 people');
        await openGroup(page);

        const main = group(page).locator('.place-row-main');
        await expect(main.locator('.place-tag')).toHaveText('main form');
        await expect(sub(page, 'H. Lhota').locator('.place-tag')).toHaveText('other spelling');
        await expect(sub(page, 'H. Lhota').locator('.place-written')).toHaveText('written in facts: H. Lhota');
        await expect(sub(page, 'H. Lhota').locator('.place-count')).toHaveText('1 fact');
        await expect(sub(page, 'H. Lhota').locator('.place-pin .place-state')).toHaveText('⌖ On the map as Horní Lhota');
        // The frame of a spelling has no actions of its own.
        await expect(sub(page, 'H. Lhota').locator('.place-pin button')).toHaveCount(0);
        await expect(sub(page, 'Ober-Lhota').locator('.place-tag')).toHaveText('old name');
        await expect(sub(page, 'Ober-Lhota').locator('.place-count')).toHaveText('1 fact · 1838–1845');
        // The house keeps its own state.
        const house = sub(page, 'Horní Lhota čp. 5');
        await expect(house.locator('.place-tag')).toHaveText('house');
        await expect(house).not.toHaveClass(/place-row-same/);
        await expect(house).not.toHaveAttribute('data-state', 'same');

        // Lhota, Lhotov and Lhoták are places of their own.
        for (const name of ['Lhota', 'Lhotov', 'Lhoták']) {
            await expect(modal(page).locator(`.places-list > .place-row[data-key="${key(name)}"]`)).toBeVisible();
        }
        // The summary counts places, not spellings: Horní Lhota, its house, Lhota, Lhotov, Lhoták.
        await expect(modal(page).locator('.places-total')).toHaveText('5 places');
    });

    test('the search finds the group by its old name', async ({ page }) => {
        await page.locator('#places-filter').fill('Ober');
        await expect(group(page)).toBeVisible();
        await expect(group(page).locator('.place-group-head .place-caret')).toHaveAttribute('aria-expanded', 'true');
        await expect(sub(page, 'Ober-Lhota')).toBeVisible();
        await expect(sub(page, 'H. Lhota')).toBeHidden();
        await expect(modal(page).locator(`.places-list > .place-row[data-key="${key('Lhotov')}"]`)).toBeHidden();
        // The other name written by nobody but the record still finds today's place.
        await page.locator('#places-filter').fill('Horní');
        await expect(group(page)).toBeVisible();
    });

    test('Unify as Horní Lhota: preview, Unify 1 fact, a toast; Undo brings the spelling back', async ({ page }) => {
        await openGroup(page);
        const r = sub(page, 'H. Lhota');
        await expect(r.locator('.place-resfix')).toHaveCount(0);
        await r.locator('.place-unify-open').click();
        const card = r.locator('.place-unify-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText('The place changes in 1 fact (1 person):');
        await expect(card.locator('.place-unify-line strong')).toHaveText('Horní Lhota');
        await expect(card).toContainText('“H. Lhota” is kept as another name of the place');
        await card.locator('.place-unify-go').click();

        await expect(toast(page)).toContainText('Unified: 1 fact now has the place Horní Lhota.');
        const state = () => page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const q = dm.getAllPersons().find(p => p.firstName === 'Quilla')!;
            return { place: q.deathPlace, aliases: (dm.getData() as unknown as { placeAliases?: Record<string, string[]> }).placeAliases ?? {} };
        });
        expect(await state()).toEqual({ place: 'Horní Lhota', aliases: { [key('Horní Lhota')]: ['H. Lhota'] } });
        await expect(sub(page, 'H. Lhota')).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.performUndo());
        await expect.poll(async () => (await state()).place).toBe('H. Lhota');
        expect((await state()).aliases).toEqual({});
        await open(page);
        await openGroup(page);
        await expect(sub(page, 'H. Lhota')).toBeVisible();
    });
});

test('the map shows Horní Lhota and its spellings as one point', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 404 }));
    await page.addInitScript(() => {
        const raw = localStorage.getItem('strom-settings');
        const settings = raw ? JSON.parse(raw) : {};
        settings.mapTiles = true;
        localStorage.setItem('strom-settings', JSON.stringify(settings));
    });
    await ownTree(page);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });
    expect(await page.locator('.map-marker').evaluateAll(ms => ms.map(m => (m as HTMLElement).dataset.key).sort()))
        .toEqual([key('Horní Lhota'), 'lhota']);
});

/** One person of the research with a birth and a death (year, place). */
function person(id: string, first: string, birth: [number, string], death?: [number, string]): string[] {
    return [
        `0 @${id}@ INDI`, `1 NAME ${first} /Brindak/`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', `2 DATE ${birth[0]}`, `2 PLAC ${birth[1]}`,
        ...(death ? ['1 DEAT', `2 DATE ${death[0]}`, `2 PLAC ${death[1]}`] : []),
    ];
}

const GED = researchGed(HEAD, [
    ...person('P0004', 'Zorbin', [1860, 'Horní Lhota'], [1878, 'Lhota']),
    ...person('P0005', 'Quilla', [1865, 'Horní Lhota'], [1875, 'H. Lhota']),
    ...person('P0006', 'Yarek', [1840, 'Ober-Lhota'], [1880, 'Lhotov']),
]);

test('a research on this computer: Fix the entry in the research instead of Unify', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fakeBridge(page, {
        features: ['places.identify'],
        links: ['send', 'open', 'live', 'app', 'setup', 'fixes'],
        treeGed: GED,
        places: fakePlaces({ reply: {
            rev: 'p1',
            places: {
                L0012: {
                    name: 'Horní Lhota', names: [{ name: 'Ober-Lhota', lang: 'de', from: 1838, to: 1845 }],
                    country: 'CZ', coords: HORNI, state: 'identified', by: 'research', at: '2026-10-20',
                    forms: ['Horní Lhota', 'H. Lhota', 'Ober-Lhota'], facts: 4, persons: 3,
                },
            },
            forms: {},
            queue: { queued: 0, running: 0 },
            counts: { offMap: 1, placed: 1, proposed: 0, unlocated: 0 },
        } }),
    });
    await openResearch(page, { ged: GED });
    await poll(page);
    await open(page);
    await expect(modal(page)).toBeVisible();
    await expect(group(page)).toHaveCount(1);
    await openGroup(page);
    const r = sub(page, 'H. Lhota');
    await expect(r.locator('.place-unify-open')).toHaveCount(0);
    await expect(r.locator('.place-resfix')).toHaveText('Fix the entry in the research ↗');
    await r.locator('.place-resfix').click();
    await expect.poll(() => links(page)).toEqual([expect.stringMatching(/^strom-research:\/\/fixes\?/)]);
});

/** A phone, upright and sideways: the group and Unify's preview stay within the screen. */
for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`a phone at ${size.width}×${size.height}: the group and the preview without horizontal scroll`, async ({ page }) => {
        await page.setViewportSize(size);
        await ownTree(page);
        await open(page);
        await expect(modal(page)).toBeVisible();
        await openGroup(page);
        await sub(page, 'H. Lhota').locator('.place-unify-open').click();
        await expect(sub(page, 'H. Lhota').locator('.place-unify-card')).toBeVisible();
        const box = await page.evaluate(() => {
            const content = document.querySelector('#places-modal .modal-content') as HTMLElement;
            const rows = [...document.querySelectorAll<HTMLElement>('#places-modal .place-group *')].filter(el => el.offsetParent !== null);
            const over = Math.max(0, ...rows.map(el => el.getBoundingClientRect().right - window.innerWidth));
            return {
                content: content.scrollWidth - content.clientWidth,
                page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                over,
            };
        });
        expect(box.content).toBeLessThanOrEqual(0);
        expect(box.page).toBeLessThanOrEqual(0);
        expect(box.over).toBeLessThanOrEqual(0);
    });
}
