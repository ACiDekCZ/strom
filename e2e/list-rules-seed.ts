/**
 * A made-up family with lists of custom rules for the management and the
 * responsive specs of the custom list rules (spec 136 §8, §11, §14, §15).
 *
 * Arvid Quellmayer (born in Mlýnky) and Dorota Talvanen (born in Vrbatín,
 * 6 km away) have Benedikt (born in Mlýnky), Cilka (born in Horní Vranice,
 * without a location) and Bětka Ostrovidová-Quellmayerová (born in a place
 * with a long name). Benedikt and Eliška Ostrovid have Gustav.
 *
 * The lists: "Mlýnky branch" (automatic, three conditions with an except,
 * from a template), "To look up" (automatic, its person deleted), "Neighbours"
 * (automatic, Another list: Mlýnky branch), "Loop A" / "Loop B" (each the
 * other's list, a loop in the stored data), "From the agent" (fixed, made by
 * the agent) "Ostrovidová-Quellmayerová family…"
 * (three levels, the long name and place) and "Wedding 2027" (fixed, by hand). Invented names only.
 */

import { expect, Page } from '@playwright/test';
import { openApp, card } from './helpers';

export const NOW = new Date('2026-11-16T10:30:00Z');

export const LONG_PLACE = 'Horní Vranice u Trnové Lhoty nad Mlýnským potokem';
export const LONG_NAME = 'Bětka Ostrovidová-Quellmayerová';
export const LONG_KEY = 'horni vranice u trnove lhoty nad mlynskym potokem';

interface Seed { firstName: string; lastName: string; gender?: 'male' | 'female'; parents?: string[]; partners?: string[]; [k: string]: unknown }

const PEOPLE: Record<string, Seed> = {
    b: { firstName: 'Benedikt', lastName: 'Quellmayer', parents: ['a', 'd'], partners: ['e'], birthDate: '1850', birthPlace: 'Mlýnky' },
    a: { firstName: 'Arvid', lastName: 'Quellmayer', partners: ['d'], birthDate: '1820', deathDate: '1880', birthPlace: 'Mlýnky' },
    d: { firstName: 'Dorota', lastName: 'Talvanen', gender: 'female', partners: ['a'], birthDate: '1825', deathDate: '1890', birthPlace: 'Vrbatín' },
    c: { firstName: 'Cilka', lastName: 'Quellmayer', gender: 'female', parents: ['a', 'd'], birthDate: '1852', birthPlace: 'Horní Vranice' },
    k: { firstName: 'Bětka', lastName: 'Ostrovidová-Quellmayerová', gender: 'female', parents: ['a', 'd'], birthDate: '1855', birthPlace: LONG_PLACE },
    e: { firstName: 'Eliška', lastName: 'Ostrovid', gender: 'female', partners: ['b'], birthDate: '1853' },
    g: { firstName: 'Gustav', lastName: 'Quellmayer', parents: ['b', 'e'], birthDate: '1880' },
};

const PLACES = {
    'mlynky': { lat: 49.5, lon: 15.0 },
    'vrbatin': { lat: 49.554, lon: 15.0 },
    [LONG_KEY]: { lat: 49.52, lon: 15.01 },
};

const cond = (c: string, p: Record<string, unknown>, not = false) => ({ t: 'cond', c, p, ...(not ? { not: true } : {}) });
const group = (op: 'all' | 'any', ...items: unknown[]) => ({ t: 'group', op, items });
const custom = (root: unknown, auto = true) => ({ v: 1, auto, root });

/** The rule of "Mlýnky branch": descendants of Arvid, and (born 1800–1860 or (Mlýnky within 10 km and women)), except died young. */
export const MILL_ROOT = group('all',
    cond('descendants', { personId: 'a', personName: 'Arvid Quellmayer', generations: 4 }),
    group('any',
        cond('born', { from: 1800, to: 1860 }),
        group('all',
            cond('near', { placeKey: 'mlynky', placeName: 'Mlýnky', events: ['birth', 'death', 'marriage', 'residence'], km: 10 }),
            cond('gender', { value: 'female' }),
        ),
    ),
    cond('deathAge', { to: 5 }, true),
);

export const LISTS = [
    {
        id: 'l-mill', name: 'Mlýnky branch', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-12T09:00:00.000Z',
        custom: custom(MILL_ROOT),
        origin: { by: 'template', template: 'nearPlace', name: 'From a place and surroundings', at: '2026-11-12T09:00:00.000Z' },
    },
    {
        id: 'l-look', name: 'To look up', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-10T09:00:00.000Z',
        custom: custom(group('all', cond('ancestors', { personId: 'zz', personName: 'Ilsa Quellmayerová' }), cond('has', { have: false, what: 'source' }))),
        origin: { by: 'template', template: 'missingSource', name: 'Ancestors without a source', at: '2026-11-10T09:00:00.000Z' },
    },
    {
        id: 'l-near', name: 'Neighbours', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-11T09:00:00.000Z',
        custom: custom(group('all', cond('list', { listId: 'l-mill', listName: 'Mlýnky branch' }))),
    },
    {
        id: 'l-loopa', name: 'Loop A', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-11T09:00:00.000Z',
        custom: custom(group('all', cond('list', { listId: 'l-loopb', listName: 'Loop B' }))),
    },
    {
        id: 'l-loopb', name: 'Loop B', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-11T09:00:00.000Z',
        custom: custom(group('all', cond('list', { listId: 'l-loopa', listName: 'Loop A' }))),
    },
    {
        id: 'l-agent', name: 'From the agent', dynamic: false, personIds: ['a', 'd'], sort: 'old', updated: '2026-11-14T09:00:00.000Z',
        origin: { by: 'agent', at: '2026-11-14T09:00:00.000Z' },
    },
    {
        // Three levels with the long name and the long place: the responsive checks.
        id: 'l-wide', name: 'Ostrovidová-Quellmayerová family around Horní Vranice u Trnové Lhoty', dynamic: false, personIds: [], sort: 'old', updated: '2026-11-15T09:00:00.000Z',
        custom: custom(group('all',
            cond('family', { personId: 'k', personName: LONG_NAME, via: 'both', width: 'line', spouses: 'none', up: 2, down: 2 }),
            group('any',
                cond('near', { placeKey: LONG_KEY, placeName: LONG_PLACE, events: ['birth', 'death'], km: 25 }),
                group('all', cond('born', { from: 1800, to: 1860 }), cond('gender', { value: 'female' })),
            ),
        )),
        origin: { by: 'template', template: 'nearPlace', name: 'From a place and surroundings', at: '2026-11-15T09:00:00.000Z' },
    },
    { id: 'l-plain', name: 'Wedding 2027', dynamic: false, personIds: ['b', 'e'], sort: 'old', updated: '2026-11-13T09:00:00.000Z' },
];

/** The family and its lists as a new tree, the focus on Benedikt. */
export async function seedFamily(page: Page, lang: 'en' | 'de' = 'en'): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    const persons: Record<string, Record<string, unknown> & { partnerships: string[]; parentIds: string[]; childIds: string[] }> = {};
    for (const [id, { parents, partners: _p, ...rest }] of Object.entries(PEOPLE)) {
        persons[id] = { id, gender: 'male', isPlaceholder: false, ...rest, partnerships: [], parentIds: [...(parents ?? [])], childIds: [] };
    }
    for (const [id, p] of Object.entries(persons)) for (const parent of p.parentIds) persons[parent].childIds.push(id);
    const partnerships: Record<string, { id: string; person1Id: string; person2Id: string; childIds: string[]; status: string }> = {};
    for (const [id, { partners }] of Object.entries(PEOPLE)) {
        for (const other of partners ?? []) {
            const uid = `u_${[id, other].sort().join('_')}`;
            if (partnerships[uid]) continue;
            const childIds = Object.keys(persons).filter(c => persons[c].parentIds.includes(id) && persons[c].parentIds.includes(other));
            partnerships[uid] = { id: uid, person1Id: id, person2Id: other, childIds, status: 'married' };
            persons[id].partnerships.push(uid);
            persons[other].partnerships.push(uid);
        }
    }
    await page.evaluate(async ({ persons, partnerships, places, personLists, lang }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, places, personLists } as never, 'Quellmayer');
        await window.Strom.TreeRenderer.setFocus('b' as never);
        if (lang !== 'en') window.Strom.UI.setLanguage(lang as never);
    }, { persons, partnerships, places: PLACES, personLists: LISTS, lang });
    await expect(card(page, 'Benedikt')).toBeVisible();
}

export const lists = (page: Page) => page.locator('#person-lists-modal');
export const form = (page: Page) => page.locator('#person-list-new');
export const listRow = (page: Page, id: string) => lists(page).locator(`.pl-row[data-list="${id}"]`);

/** The lists open, one chosen. */
export async function openList(page: Page, id: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPersonLists());
    await listRow(page, id).click();
}

/** Elements of `root` wider inside than their box (text or children cut or overflowing), as "tag.class: scroll > client". */
export async function overflowing(page: Page, root: string): Promise<string[]> {
    return page.evaluate((sel) => {
        const out: string[] = [];
        for (const box of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            for (const el of [box, ...Array.from(box.querySelectorAll<HTMLElement>('*'))]) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
                // Text cut with an ellipsis is the design (the whole text is in title / aria-label).
                if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '') continue;
                if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
                    out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${el.scrollWidth} > ${el.clientWidth}`);
                }
            }
        }
        return out;
    }, root);
}

/** Pairs of visible boxes in `root` matching `sel` that overlap (more than 1 px). */
export async function overlapping(page: Page, root: string, sel: string): Promise<string[]> {
    return page.evaluate(({ root, sel }) => {
        const els = Array.from(document.querySelectorAll<HTMLElement>(`${root} ${sel}`)).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
        const out: string[] = [];
        for (let i = 0; i < els.length; i++) {
            for (let j = i + 1; j < els.length; j++) {
                if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
                const a = els[i].getBoundingClientRect();
                const b = els[j].getBoundingClientRect();
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 1 && h > 1) out.push(`${els[i].className} × ${els[j].className}`);
            }
        }
        return out;
    }, { root, sel });
}
