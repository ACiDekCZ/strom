import { describe, it, expect } from 'vitest';
import type { StromData, PlaceGeo } from '../types.js';
import type { PlaceIdentity, PlaceStateSummary } from '../place-identity.js';
import {
    placeRowActions, canLookUp, canCheck, hasWhyHere, groupCheckState, selectionCounts, placeContextLine,
    placeYearSpans, formatYearSpan, checkFindingText, countryName, formerNameText, placeLocationLabel,
    placeFormerLine, placeWhyRows, districtNameHasTitle, variantRowAction, townGroupsBesideVariants, variantGroupView, placesOfferStep,
    type VariantGroupFilterInput, type VariantMemberFilter,
} from '../places-dialog.js';
import type { PlaceVariantGroup } from '../place-groups.js';
import { placeKey } from '../places.js';

const id = (state: PlaceIdentity['state'], extra: Partial<PlaceIdentity> = {}): PlaceIdentity =>
    ({ state, located: ['placed', 'verified', 'check', 'town'].includes(state), ...extra });

const summary = (s: Partial<PlaceStateSummary> = {}): PlaceStateSummary =>
    ({ total: 10, map: 5, check: 0, confirm: 0, undet: 0, research: 0, none: 0, ...s });

describe('placeRowActions', () => {
    const res = { canResearch: true, hasGeo: true };
    const app = { canResearch: false, hasGeo: true };

    it('offers the actions of each state, the ◆ ones only with the research here', () => {
        expect(placeRowActions(id('none'), { canResearch: true, hasGeo: false })).toEqual(['find', 'look']);
        expect(placeRowActions(id('none'), { canResearch: false, hasGeo: false })).toEqual(['find']);
        expect(placeRowActions(id('queued'), res)).toEqual(['unqueue']);
        expect(placeRowActions(id('queued'), app)).toEqual([]);
        expect(placeRowActions(id('running'), res)).toEqual([]);
        expect(placeRowActions(id('confirm'), app)).toEqual(['answer', 'findQuiet']);
        expect(placeRowActions(id('undet'), res)).toEqual(['why', 'lookAgain', 'findQuiet']);
        expect(placeRowActions(id('undet'), app)).toEqual(['why', 'findQuiet']);
        expect(placeRowActions(id('check'), res)).toEqual(['keep', 'change', 'check', 'whyQuiet']);
        expect(placeRowActions(id('check'), app)).toEqual(['keep', 'change', 'whyQuiet']);
        expect(placeRowActions(id('town'), { ...res, byTown: true })).toEqual(['change', 'look']);
    });

    it('a placed location: Check unless placed by hand, Remove unless it is by the town', () => {
        expect(placeRowActions(id('placed', { origin: 'map' }), res)).toEqual(['why', 'change', 'check', 'remove']);
        expect(placeRowActions(id('placed', { origin: 'hand' }), res)).toEqual(['why', 'change', 'remove']);
        expect(placeRowActions(id('verified', { origin: 'research' }), app)).toEqual(['why', 'change', 'remove']);
        expect(placeRowActions(id('placed', { origin: 'research' }), { canResearch: true, hasGeo: false })).toEqual(['why', 'change', 'check']);
    });

    it('what a selection or a step takes', () => {
        expect(['none', 'undet', 'town', 'check'].every(s => canLookUp(id(s as PlaceIdentity['state'])))).toBe(true);
        expect(['queued', 'running', 'confirm', 'placed', 'verified'].some(s => canLookUp(id(s as PlaceIdentity['state'])))).toBe(false);
        expect(canCheck(id('placed', { origin: 'map' }))).toBe(true);
        expect(canCheck(id('check', { origin: 'research' }))).toBe(true);
        expect(canCheck(id('placed', { origin: 'hand' }))).toBe(false);
        expect(canCheck(id('none'))).toBe(false);
        expect(hasWhyHere(id('undet'))).toBe(true);
        expect(hasWhyHere(id('none'))).toBe(false);
        expect(hasWhyHere(id('queued'))).toBe(false);
    });
});

describe('selection', () => {
    it('a group head is checked, unchecked or mixed', () => {
        expect(groupCheckState([])).toBe('false');
        expect(groupCheckState([false, false])).toBe('false');
        expect(groupCheckState([true, true])).toBe('true');
        expect(groupCheckState([true, false])).toBe('mixed');
    });

    it('counts what Look up selected and Check selected take', () => {
        expect(selectionCounts([id('none'), id('placed', { origin: 'map' }), id('placed', { origin: 'hand' }), id('check'), id('queued')]))
            .toEqual({ look: 2, check: 2, total: 5 });
    });
});

describe('placeContextLine', () => {
    it('another computer and a phone come first', () => {
        expect(placeContextLine({ access: 'elsewhere', filter: 'confirm', summary: summary(), queued: 3 })).toBe('elsewhere');
        expect(placeContextLine({ access: 'phone', filter: 'none', summary: summary(), queued: 0 })).toBe('phone');
    });

    it('then the chip, then the queue', () => {
        const s = summary({ none: 3, check: 1, confirm: 2 });
        expect(placeContextLine({ access: 'ok', filter: 'confirm', summary: s, queued: 2 })).toBe('confirm');
        expect(placeContextLine({ access: 'ok', filter: 'none', summary: s, queued: 2 })).toBe('none');
        expect(placeContextLine({ access: 'ok', filter: 'check', summary: s, queued: 2 })).toBe('check');
        expect(placeContextLine({ access: 'ok', filter: 'all', summary: s, queued: 2 })).toBe('queue');
        expect(placeContextLine({ access: 'ok', filter: 'all', summary: s, queued: 0 })).toBeNull();
    });

    it('without the research: the check line only; an old research says so at No location', () => {
        expect(placeContextLine({ access: 'none', filter: 'none', summary: summary(), queued: 0 })).toBeNull();
        expect(placeContextLine({ access: 'none', filter: 'check', summary: summary(), queued: 0 })).toBe('check');
        expect(placeContextLine({ access: 'old', filter: 'none', summary: summary(), queued: 0 })).toBe('old');
        expect(placeContextLine({ access: 'old', filter: 'all', summary: summary(), queued: 4 })).toBeNull();
    });
});

describe('placesOfferStep (the offer after an import or a link)', () => {
    it('only armed; asks with the research here, drops it without one or with one that does not look up places, else waits', () => {
        expect(placesOfferStep(false, 'ok')).toBe('idle');
        expect(placesOfferStep(true, 'ok')).toBe('ask');
        expect(placesOfferStep(true, 'none')).toBe('drop');
        expect(placesOfferStep(true, 'old')).toBe('drop');
        expect(placesOfferStep(true, 'phone')).toBe('wait');
        expect(placesOfferStep(true, 'elsewhere')).toBe('wait');
    });
});

describe('years', () => {
    it('spans the years of the facts written at a place', () => {
        const data = {
            persons: {
                a: { id: 'a', birthPlace: 'Lhota', birthDate: '1820', deathPlace: 'Jinov', deathDate: '1871-04-03', events: [] },
                b: { id: 'b', birthPlace: 'Lhota', birthDate: '1866-05-01', events: [{ type: 'residence', place: 'Lhota', date: 'about 1890' }] },
                c: { id: 'c', birthPlace: 'Lhotov', events: [] },
            },
            partnerships: {},
        } as unknown as StromData;
        const spans = placeYearSpans(data);
        expect(spans.get(placeKey('Lhota'))?.[0]).toBe(1820);
        expect(spans.get(placeKey('Lhota'))?.[1]).toBeGreaterThanOrEqual(1866);
        expect(spans.get(placeKey('Jinov'))).toEqual([1871, 1871]);
        expect(spans.has(placeKey('Lhotov'))).toBe(false);
        expect(formatYearSpan([1820, 1871])).toBe('1820–1871');
        expect(formatYearSpan([1866, 1866])).toBe('1866');
        expect(formatYearSpan(undefined)).toBe('');
    });
});

describe('texts', () => {
    it('the check findings in all three languages', () => {
        expect(checkFindingText({ kind: 'far', km: 120, family: 'Lhoták', years: [1820, 1871] }, 'en'))
            .toBe('120 km from the other places of the Lhoták family in 1820–1871.');
        expect(checkFindingText({ kind: 'district', expected: 'Jinov', actual: 'Lhotov', jurisdiction: 'parish' }, 'en'))
            .toContain('parish of Jinov');
        expect(checkFindingText({ kind: 'label', type: 'street' }, 'en')).toBe('The map found a street, not a town.');
        for (const lang of ['cs', 'de'] as const) {
            expect(checkFindingText({ kind: 'multi' }, lang)).not.toBe(checkFindingText({ kind: 'multi' }, 'en'));
        }
        // The check says how many towns of the name the map found.
        expect(checkFindingText({ kind: 'multi', count: 3 }, 'en')).toBe('The map found 3 towns with this name and took the one nearest the tree’s other places.');
        expect(checkFindingText({ kind: 'multi', count: 5 }, 'cs')).toContain('5 obcí');
        expect(checkFindingText({ kind: 'multi', count: 3 }, 'pl')).toContain('3 miejscowości');
    });

    it('a country code by the UI language, anything else as written', () => {
        expect(countryName('CZ', 'en')).toMatch(/Czech/);
        expect(countryName('Lhotsko', 'en')).toBe('Lhotsko');
        expect(countryName(undefined, 'en')).toBe('');
    });

    it('former names with their years', () => {
        expect(formerNameText({ name: 'Ober Lhota', to: 1945 }, 'en')).toBe('Ober Lhota (until 1945)');
        expect(formerNameText({ name: 'Lhota', from: 1946 }, 'en')).toBe('Lhota (since 1946)');
        expect(formerNameText({ name: 'Lhota', from: 1850, to: 1900 }, 'en')).toBe('Lhota (1850–1900)');
        expect(formerNameText({ name: 'Lhota' }, 'en')).toBe('Lhota');
    });

    it('the location label: the record’s today, else the map’s label, else coordinates', () => {
        const geo: PlaceGeo = { lat: 49.61234, lon: 15.2345 };
        expect(placeLocationLabel(id('placed', { today: { name: 'Horní Lhota', district: 'Lhotov', country: 'CZ' } }), geo, 'en'))
            .toMatch(/^Horní Lhota, Lhotov District, Czech/);
        expect(placeLocationLabel(id('placed'), { ...geo, label: 'Lhota, Jinov' }, 'en')).toBe('Lhota, Jinov');
        expect(placeLocationLabel(id('placed'), geo, 'en')).toBe('49.612, 15.235');
        expect(placeLocationLabel(id('none'), undefined, 'en')).toBe('');
    });

    it('a district name that carries its title gets no second one', () => {
        const titled = id('verified', { today: { name: 'Bělušice', district: 'okresní hejtmanství Kolín' } });
        expect(placeLocationLabel(titled, undefined, 'cs')).toBe('Bělušice, okresní hejtmanství Kolín');
        expect(placeLocationLabel(titled, undefined, 'en')).toBe('Bělušice, okresní hejtmanství Kolín');
        expect(placeLocationLabel(titled, undefined, 'de')).toBe('Bělušice, okresní hejtmanství Kolín');
        expect(placeLocationLabel(id('placed', { today: { name: 'Lhota', district: 'Bezirk Lhotau' } }), undefined, 'cs')).toBe('Lhota, Bezirk Lhotau');
        expect(placeLocationLabel(id('placed', { today: { name: 'Lhota', district: 'Lhotov District' } }), undefined, 'de')).toBe('Lhota, Lhotov District');
        // A bare name gets the language's word.
        const bare = id('placed', { today: { name: 'Lhota', district: 'Lhotov' } });
        expect(placeLocationLabel(bare, undefined, 'cs')).toBe('Lhota, okres Lhotov');
        expect(placeLocationLabel(bare, undefined, 'de')).toBe('Lhota, Bezirk Lhotov');
        // A name merely containing the letters of a title word is not titled.
        expect(districtNameHasTitle('Okresice')).toBe(false);
        expect(districtNameHasTitle('Krajková')).toBe(false);
        expect(districtNameHasTitle('Landkreis Lhotau')).toBe(true);
        // The check's sentence too.
        const f = { kind: 'district', expected: 'okresní hejtmanství Kolín', actual: 'Nymburk' } as const;
        expect(checkFindingText(f, 'cs')).toBe('Záznamy uvádějí okresní hejtmanství Kolín, poloha je v okrese Nymburk.');
        expect(checkFindingText(f, 'en')).toBe('The records name okresní hejtmanství Kolín; the location is in Nymburk District.');
        expect(checkFindingText(f, 'de')).toBe('Die Einträge nennen okresní hejtmanství Kolín, die Lage ist im Bezirk Nymburk.');
        expect(checkFindingText({ ...f, expected: 'Kolín' }, 'cs')).toBe('Záznamy uvádějí okres Kolín, poloha je v okrese Nymburk.');
    });

    it('the former line only when today’s name differs from what the tree writes', () => {
        const rec = id('placed', {
            today: { name: 'Horní Lhota' },
            former: [{ name: 'Ober Lhota', to: 1945 }, { name: 'Lhota Horní', from: 1850, to: 1900 }],
        });
        expect(placeFormerLine(rec, 'Ober Lhota', 'en')).toBe('formerly Ober Lhota (until 1945)');
        expect(placeFormerLine(rec, 'Lhota nahoře', 'en')).toBe('formerly Ober Lhota (until 1945) · Lhota Horní (1850–1900)');
        expect(placeFormerLine(rec, 'Horní Lhota', 'en')).toBe('');
    });
});

describe('placeWhyRows', () => {
    it('only the rows that say something, in order', () => {
        const rows = placeWhyRows(id('verified', {
            origin: 'research', at: '2026-11-03', today: { name: 'Horní Lhota' }, former: [{ name: 'Ober Lhota', to: 1945 }],
            why: 'Fara Jinov.', source: { title: 'Matrika Jinov', url: 'https://example.org/m/1' },
        }), { lat: 49.6, lon: 15.2 }, 'en');
        expect(rows.map(r => r.kind)).toEqual(['today', 'before', 'who', 'why', 'source']);
        expect(rows.find(r => r.kind === 'who')).toMatchObject({ origin: 'research', at: '2026-11-03' });
        expect(rows.find(r => r.kind === 'source')?.url).toBe('https://example.org/m/1');
    });

    it('a hand placement says the research does not move it; checks are warnings, the first one labelled', () => {
        const rows = placeWhyRows(id('check', {
            origin: 'hand', checks: [{ kind: 'far', km: 90, family: 'Lhoták', years: [1820, 1820] }, { kind: 'multi' }],
        }), { lat: 49.6, lon: 15.2, label: 'Lhota' }, 'en');
        expect(rows.map(r => r.kind)).toEqual(['today', 'who', 'who', 'check', 'check']);
        expect(rows[2]).toMatchObject({ label: '', tone: 'muted' });
        expect(rows[3]).toMatchObject({ label: 'Check', tone: 'warn' });
        expect(rows[4]).toMatchObject({ label: '', tone: 'muted' });
    });

    it('not identified: no Today; what would decide; a source link only over http(s)', () => {
        const rows = placeWhyRows(id('undet', {
            why: 'Two parishes.', decide: 'A record with the parish.', source: { title: 'Matrika', url: 'javascript:alert(1)' },
        }), undefined, 'en');
        expect(rows.map(r => r.kind)).toEqual(['why', 'decide', 'source']);
        expect(rows[2].url).toBeUndefined();
    });
});

describe('groups of spellings (§4)', () => {
    it('offers Unify in the tree, the research’s fix with the research here, nothing on the main form or a house', () => {
        expect(variantRowAction('var', true, false)).toBe('unify');
        expect(variantRowAction('old', true, false)).toBe('unify');
        expect(variantRowAction('street', true, true)).toBe('resFix');
        expect(variantRowAction('main', true, false)).toBeNull();
        expect(variantRowAction('house', false, false)).toBeNull();
    });

    it('drops the town groups whose town or houses are in a group of spellings', () => {
        const variant: PlaceVariantGroup = {
            key: 'L0012', head: 'Horní Lhota', ownKey: 'horni lhota', spellings: 1, houses: 1, facts: 5, persons: 4,
            members: [{ key: 'h lhota', tag: 'var', same: true }, { key: 'horni lhota 16', tag: 'house', same: false }],
        };
        const towns = [
            { townKey: 'horni lhota', members: [{ key: 'horni lhota 16' }, { key: 'horni lhota 17' }] },
            { townKey: 'jinov', ownKey: 'jinov', members: [{ key: 'jinov 1' }, { key: 'jinov 2' }] },
        ];
        expect(townGroupsBesideVariants(towns, [variant]).map(t => t.townKey)).toEqual(['jinov']);
        expect(townGroupsBesideVariants(towns, [])).toHaveLength(2);
    });

    const member = (o: Partial<VariantMemberFilter> = {}): VariantMemberFilter =>
        ({ same: true, main: false, textMatch: false, statePass: true, ...o });
    const input = (o: Partial<VariantGroupFilterInput> = {}): VariantGroupFilterInput => ({
        query: false, chip: false, expanded: false, showAll: false, first: 8,
        groupMatch: true, headStatePass: true,
        members: [member({ main: true }), member(), member({ same: false })],
        ...o,
    });

    it('shows the group as it is without a search, opened when opened', () => {
        expect(variantGroupView(input())).toMatchObject({ hidden: false, open: false, head: true, members: [false, false, false], found: 3 });
        expect(variantGroupView(input({ expanded: true })).members).toEqual([true, true, true]);
    });

    it('opens the group on the spelling a search finds there', () => {
        const v = variantGroupView(input({
            query: true,
            members: [member({ main: true }), member({ textMatch: true }), member({ same: false })],
        }));
        expect(v).toMatchObject({ hidden: false, open: true, head: true, members: [false, true, false], found: 2 });
    });

    it('shows the group as it is when only the head\'s names hold the query', () => {
        const v = variantGroupView(input({ query: true, members: [member({ main: true, textMatch: true }), member(), member({ same: false })] }));
        expect(v).toMatchObject({ hidden: false, open: false, head: true, members: [false, false, false], found: 3 });
    });

    it('hides the group the search does not find', () => {
        expect(variantGroupView(input({ query: true, groupMatch: false })).hidden).toBe(true);
    });

    it('a chip passes the head and the houses by their own states, never a spelling', () => {
        const v = variantGroupView(input({ chip: true, headStatePass: false, members: [member({ main: true }), member(), member({ same: false })] }));
        expect(v).toMatchObject({ hidden: false, open: true, members: [false, false, true], found: 1 });
        const none = variantGroupView(input({ chip: true, headStatePass: false, members: [member({ main: true }), member(), member({ same: false, statePass: false })] }));
        expect(none.hidden).toBe(true);
        const head = variantGroupView(input({ chip: true, members: [member({ main: true }), member(), member({ same: false, statePass: false })] }));
        expect(head).toMatchObject({ hidden: false, open: false, head: true, found: 1 });
    });
});
