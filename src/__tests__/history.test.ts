/**
 * History in the life timeline (spec 020): payload validation, place matching,
 * where a person lived, life filter, age, hidings, year groups, card states
 * and the Settings status row. Pure, fictional data (Lhota, Lhotákovi).
 */

import { describe, it, expect } from 'vitest';
import {
    parseHistoryPayload, parseHistoryText, parseHistoryEvent, isHistoryLang, matchHistoryPlace,
    residencePoints, placesInYear, computePersonHistory, effectiveHidden, queueHideOp,
    groupHistoryByYear, historyClusterLabel, historySettingsStatus, historyHiddenList, historyHiddenCount,
    sanitizeHideQueue, sanitizeCachedHistory, HISTORY_LIMITS,
    type HistoryPayload, type HistorySettingsInput, type HistoryHideOp,
} from '../history.js';
import { computePersonLifeline } from '../timeline.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, LifeEvent } from '../types.js';

const AT = '2026-10-27T14:05:00Z';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Lhoták', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...o,
    } as Person;
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const residence = (date: string, place: string, id = `r${date}`): LifeEvent => ({ id, type: 'residence', date, place });

function regionEvent(id: string, from: number, o: Record<string, unknown> = {}) {
    return {
        id, from, kind: 'war', scope: 'region',
        region: { id: 'cz-bohemia', name: { cs: 'Čechy', en: 'Bohemia', de: 'Böhmen' } },
        text: { cs: `Událost ${id}`, en: `Event ${id}`, de: `Ereignis ${id}` },
        source: { title: 'Titul', publisher: 'Wikipedie', url: 'https://cs.wikipedia.org/wiki/X', checked: '2026-10-27' },
        ...o,
    };
}
function localEvent(id: string, from: number, o: Record<string, unknown> = {}) {
    return {
        id, from, kind: 'epidemic', scope: 'local',
        text: { cs: `Místní ${id}` },
        local: { source: 'S0004', clip: 'C0012', cite: 'Matrika zemřelých Lhota' },
        ...o,
    };
}
function payload(raw: Record<string, unknown>): HistoryPayload {
    const p = parseHistoryPayload({ state: { on: true, search: 'done', at: AT }, lang: 'cs', events: [], places: {}, hidden: [], ...raw }, AT);
    if (!p) throw new Error('payload');
    return p;
}

describe('parseHistoryPayload', () => {
    it('drops invalid events, never the whole reply', () => {
        const p = payload({
            events: [
                regionEvent('cz-bohemia-0001', 1866),
                { id: 'bad id!', from: 1866, kind: 'war', scope: 'region', text: { cs: 'x' }, source: { title: 't', url: 'https://x' } },
                regionEvent('cz-bohemia-0002', 1870, { source: undefined }),           // neither source nor local
                regionEvent('cz-bohemia-0003', 1870, { source: { title: 't', url: 'http://insecure' } }),
                regionEvent('cz-bohemia-0004', 1880, { kind: 'volcano' }),             // unknown kind → other
                regionEvent('cz-bohemia-0001', 1999),                                   // duplicate id
                localEvent('L0001', 1866),
                localEvent('L0002', 1866, { local: { source: 'S1' } }),                // no cite → invalid local
                'nonsense',
            ],
        });
        expect(p.events.map(e => e.id)).toEqual(['cz-bohemia-0001', 'cz-bohemia-0004', 'L0001']);
        expect(p.events[1].kind).toBe('other');
        expect(p.events[0].from).toBe(1866);
    });

    it('caps events at 3000 and places at 5000', () => {
        const events = Array.from({ length: 3100 }, (_, i) => regionEvent(`e-${i}`, 1800 + (i % 100)));
        const places: Record<string, unknown> = {};
        for (let i = 0; i < 5100; i++) places[`Misto ${i}`] = { events: ['e-1'] };
        const p = payload({ events, places });
        expect(p.events).toHaveLength(HISTORY_LIMITS.events);
        expect(Object.keys(p.places)).toHaveLength(HISTORY_LIMITS.places);
    });

    it('caps also-names at 20, each at most 200 chars, and keeps only known event ids', () => {
        const also = Array.from({ length: 25 }, (_, i) => `Jméno ${i}`);
        also.splice(1, 0, 'x'.repeat(201));
        const p = payload({
            events: [regionEvent('a-1', 1866)],
            places: { Lhota: { events: ['a-1', 'unknown', 'a-1'], also, state: 'pending' }, Nic: { events: [], state: 'weird' } },
        });
        expect(p.places.Lhota.events).toEqual(['a-1']);
        expect(p.places.Lhota.also).toHaveLength(20);
        expect(p.places.Lhota.also!.every(a => a.length <= 200)).toBe(true);
        expect(p.places.Lhota.state).toBe('pending');
        expect(p.places.Nic.state).toBeUndefined();
    });

    it('clips quote to 300 chars instead of dropping the event; lang only in a valid shape', () => {
        const p = payload({
            events: [
                regionEvent('a-1', 1866, { source: { title: 't', url: 'https://x.cz', quote: 'q'.repeat(400), lang: 'cs', checked: '2026-10-27' } }),
                regionEvent('a-2', 1866, { source: { title: 't', url: 'https://x.cz', lang: 'Czech!' } }),
            ],
            lang: 'not a lang',
        });
        expect(p.events[0].source!.quote).toHaveLength(300);
        expect(p.events[0].source!.lang).toBe('cs');
        expect(p.events[1].source!.lang).toBeUndefined();
        expect(p.lang).toBeUndefined();
        expect(isHistoryLang('en-GB')).toBe(true);
        expect(isHistoryLang('de-AT-x')).toBe(false);
        expect(isHistoryLang('EN')).toBe(false);
    });

    it('ignores text keys that are not language codes; an event without any text is dropped', () => {
        expect(parseHistoryEvent(regionEvent('a', 1866, { text: { cs: 'ok', 'bad key': 'x' } }))!.text).toEqual({ cs: 'ok' });
        expect(parseHistoryEvent(regionEvent('a', 1866, { text: { 'bad key': 'x' } }))).toBeNull();
    });

    it('drops `to` before `from` and reads state and hidden defensively', () => {
        const p = payload({
            events: [regionEvent('a-1', 1866, { to: 1860 })],
            state: { on: 'yes', search: 'nonsense', pending: -1, truncated: true, rev: 'r1' },
            hidden: [{ event: 'a-1', place: 'Lhota' }, { event: 'a-1' }, { event: 'a-2', person: 'P0012' }, 7],
        });
        expect(p.events[0].to).toBeUndefined();
        expect(p.state).toEqual({ on: false, search: 'none', truncated: true, rev: 'r1' });
        expect(p.rev).toBe('r1');
        expect(p.hidden).toEqual([{ event: 'a-1', place: 'Lhota' }, { event: 'a-2', person: 'P0012' }]);
    });

    it('refuses a reply over 8 MB whole and text that is not JSON', () => {
        const big = JSON.stringify({ state: {}, events: [], places: {}, hidden: [], pad: 'x'.repeat(HISTORY_LIMITS.bytes) });
        expect(parseHistoryText(big, AT)).toBeNull();
        expect(parseHistoryText('<html>', AT)).toBeNull();
        expect(parseHistoryText('{"state":{"on":true,"search":"done"}}', AT)!.state.search).toBe('done');
    });

    it('round-trips through the cache sanitizer', () => {
        const p = payload({ events: [regionEvent('a-1', 1866)], places: { Lhota: { events: ['a-1'] } } });
        expect(sanitizeCachedHistory(JSON.parse(JSON.stringify(p)))).toEqual(p);
        expect(sanitizeCachedHistory({ events: [] })).toBeNull();
    });
});

describe('matchHistoryPlace', () => {
    const p = payload({
        places: {
            Lhota: { events: [], also: ['Ellhotten', 'Lhota u Lhotky'] },
            'Lhota u Lhotky': { events: [] },
            Lhotka: { events: [], also: ['Ellhotten', 'Lhotka nad Řekou'] },
        },
    });
    it('matches by placeKey: diacritics, case and punctuation do not matter', () => {
        expect(matchHistoryPlace(p, 'lhota')).toBe('Lhota');
        expect(matchHistoryPlace(p, 'LHOTKA')).toBe('Lhotka');
        expect(matchHistoryPlace(p, 'Lhotka nad Rekou')).toBe('Lhotka');
    });
    it('an exact key wins over an also-name', () => {
        expect(matchHistoryPlace(p, 'Lhota u Lhotky')).toBe('Lhota u Lhotky');
    });
    it('an also-name of two different places matches none', () => {
        expect(matchHistoryPlace(p, 'Ellhotten')).toBeNull();
        expect(matchHistoryPlace(p, 'Praha')).toBeNull();
        expect(matchHistoryPlace(p, '')).toBeNull();
    });
});

describe('where a person lived', () => {
    const d = data([person('a', {
        birthDate: '1838', birthPlace: 'Lhota',
        events: [residence('1870', 'Horní Lhota'), residence('1880', 'Lhotka')],
        deathDate: '1900', deathPlace: 'Lhotka',
    })]);
    const pts = residencePoints(computePersonLifeline(d, 'a'));
    it('takes the nearest dated point; a tie takes the earlier one', () => {
        expect(placesInYear(pts, 1850)).toEqual(['Lhota']);
        expect(placesInYear(pts, 1854)).toEqual(['Lhota']);     // 16 vs 16 → earlier
        expect(placesInYear(pts, 1855)).toEqual(['Horní Lhota']);
        expect(placesInYear(pts, 1830)).toEqual(['Lhota']);
        expect(placesInYear(pts, 1950)).toEqual(['Lhotka']);
    });
    it('a year right on a move gives both places', () => {
        expect(placesInYear(pts, 1870)).toEqual(['Lhota', 'Horní Lhota']);
        expect(placesInYear(pts, 1900)).toEqual(['Lhotka']);    // same place, no move
    });
});

describe('computePersonHistory', () => {
    const anna = person('anna', {
        refn: 'P0012', gender: 'female',
        birthDate: '1838', birthPlace: 'Lhota',
        events: [residence('1870', 'Horní Lhota')],
        deathDate: '1890', deathPlace: 'Horní Lhota',
        partnerships: ['u1' as PartnershipId],
    });
    const josef = person('josef', { birthDate: '1835', birthPlace: 'Lhota', deathDate: '1880', deathPlace: 'Lhota', partnerships: ['u1' as PartnershipId] });
    const u1: Partnership = {
        id: 'u1' as PartnershipId, person1Id: 'josef' as PersonId, person2Id: 'anna' as PersonId, childIds: [],
        status: 'married', startDate: '1862', startPlace: 'Lhota',
    } as Partnership;
    const d = data([anna, josef], [u1]);
    const base = {
        events: [
            regionEvent('cz-bohemia-0001', 1820),                // before birth
            regionEvent('cz-bohemia-0002', 1866, { to: 1868 }),  // in Lhota
            localEvent('L0001', 1866),                            // in Lhota, same year
            regionEvent('cz-moravia-0001', 1880, { region: { id: 'cz-moravia', name: { cs: 'Morava' } } }),
            regionEvent('cz-bohemia-0003', 1895),                // after death
            regionEvent('cz-bohemia-0004', 1870),                // year of the move: in both places
        ],
        places: {
            Lhota: { events: ['cz-bohemia-0001', 'cz-bohemia-0002', 'L0001', 'cz-bohemia-0004'] },
            'Horní Lhota': { events: ['cz-moravia-0001', 'cz-bohemia-0004'] },
        },
    };

    it('shows events of the places and years of the life, with age, sorted region before local', () => {
        const r = computePersonHistory(d, 'anna', payload(base), 'cs');
        expect(r.items.map(i => i.ev.id)).toEqual(['cz-bohemia-0002', 'L0001', 'cz-bohemia-0004', 'cz-moravia-0001']);
        expect(r.items[0]).toMatchObject({ year: 1866, yearLabel: '1866–1868', age: 'věk 28–30', place: 'Lhota', placeKey: 'Lhota' });
        expect(r.items[1].age).toBe('věk 28');
        expect(r.state).toEqual({ kind: 'events', somePending: false });
    });

    it('labels the region only when the events come from two or more regions; local shows its place', () => {
        const r = computePersonHistory(d, 'anna', payload(base), 'en');
        const byId = Object.fromEntries(r.items.map(i => [i.ev.id, i]));
        expect(byId['cz-bohemia-0002'].regionLabel).toBe('Bohemia');
        expect(byId['cz-moravia-0001'].regionLabel).toBe('Morava');   // no en name → research language
        expect(byId.L0001.regionLabel).toBe('Lhota');
        const one = computePersonHistory(d, 'anna', payload({ ...base, places: { Lhota: base.places.Lhota } }), 'cs');
        expect(one.items.every(i => i.regionLabel === undefined)).toBe(true);
    });

    it('picks text in the UI language, then the research language, then any', () => {
        const r = computePersonHistory(d, 'anna', payload(base), 'de');
        expect(r.items[0]).toMatchObject({ text: 'Ereignis cz-bohemia-0002', textLang: 'de' });
        expect(r.items[1]).toMatchObject({ text: 'Místní L0001', textLang: 'cs' });
    });

    it('a person without a birth year gets no age and the life starts at the first dated point', () => {
        const noBirth = person('x', { events: [residence('1860', 'Lhota')], deathDate: '1880', deathPlace: 'Lhota' });
        const r = computePersonHistory(data([noBirth]), 'x', payload(base), 'cs');
        expect(r.items.map(i => i.ev.id)).toEqual(['cz-bohemia-0002', 'L0001', 'cz-bohemia-0004']);
        expect(r.items.every(i => i.age === '')).toBe(true);
    });

    it('without a death year the life ends at the last dated point', () => {
        const living = person('y', { birthDate: '1850', birthPlace: 'Lhota', events: [residence('1867', 'Lhota')] });
        const r = computePersonHistory(data([living]), 'y', payload(base), 'cs');
        expect(r.items.map(i => i.ev.id)).toEqual(['cz-bohemia-0002', 'L0001']);
    });

    it('hides by place (also through an also-name), by person REFN, and from the local queue', () => {
        const p = payload({
            ...base,
            places: { ...base.places, Lhota: { ...base.places.Lhota, also: ['Ellhota'] } },
            hidden: [{ event: 'cz-bohemia-0002', place: 'Ellhota' }, { event: 'L0001', person: 'P0012' }],
        });
        const r = computePersonHistory(d, 'anna', p, 'cs');
        expect(r.items.map(i => i.ev.id)).toEqual(['cz-bohemia-0004', 'cz-moravia-0001']);
        expect(r.hidden.map(i => i.ev.id)).toEqual(['cz-bohemia-0002', 'L0001']);
        // Josef was in Lhota in 1866 too: the place hiding applies to him, the person one does not.
        const j = computePersonHistory(d, 'josef', p, 'cs');
        expect(j.items.map(i => i.ev.id)).toContain('L0001');
        expect(j.items.map(i => i.ev.id)).not.toContain('cz-bohemia-0002');

        const queue: HistoryHideOp[] = [{ event: 'cz-moravia-0001', personId: 'anna', at: AT }];
        const q = computePersonHistory(d, 'anna', p, 'cs', { queue });
        expect(q.items.map(i => i.ev.id)).toEqual(['cz-bohemia-0004']);
        expect(q.hidden.find(i => i.ev.id === 'cz-moravia-0001')!.hiddenBy.queued).toBe(true);
    });

    it('an event hidden at one place of a move year still shows through the other place', () => {
        const p = payload({ ...base, hidden: [{ event: 'cz-bohemia-0004', place: 'Lhota' }] });
        const r = computePersonHistory(d, 'anna', p, 'cs');
        const item = r.items.find(i => i.ev.id === 'cz-bohemia-0004');
        expect(item?.place).toBe('Horní Lhota');
    });

    describe('card states (§5)', () => {
        const nothing = { events: [], places: {} };
        it('6: no place with a year', () => {
            const noPlace = person('n', { birthDate: '1850', deathDate: '1900' });
            expect(computePersonHistory(data([noPlace]), 'n', payload(base), 'cs').state).toEqual({ kind: 'noPlace' });
        });
        it('4b: events and some places pending', () => {
            const p = payload({ ...base, places: { ...base.places, 'Horní Lhota': { events: [], state: 'pending' } } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'events', somePending: true });
        });
        it('9: all hidden', () => {
            const p = payload({ events: [regionEvent('a-1', 1866)], places: { Lhota: { events: ['a-1'] } }, hidden: [{ event: 'a-1', place: 'Lhota' }] });
            const r = computePersonHistory(d, 'anna', p, 'cs');
            expect(r.state).toEqual({ kind: 'allHidden' });
            expect(r.hidden).toHaveLength(1);
        });
        it('7: archive or waiting for its agent, before "no search"', () => {
            const p = payload({ ...nothing, state: { on: false, search: 'waiting', why: 'archiv' } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'waiting', why: 'archiv' });
            const q = payload({ ...nothing, state: { on: true, search: 'done' } });
            expect(computePersonHistory(d, 'anna', q, 'cs', { treeState: 'archive' }).state.kind).toBe('waiting');
        });
        it('3: the research does not search (the live status wins over the payload)', () => {
            const p = payload({ ...nothing, state: { on: false, search: 'done' } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'noSearch', link: false });
            const q = payload({ ...nothing, state: { on: true, search: 'done' } });
            expect(computePersonHistory(d, 'anna', q, 'cs', { searchOn: false }).state.kind).toBe('noSearch');
        });
        it('4: a place pending, or a missing place while the search runs', () => {
            const p = payload({ events: [], places: { Lhota: { events: [], state: 'pending' } } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'searching' });
            const q = payload({ ...nothing, state: { on: true, search: 'running' } });
            expect(computePersonHistory(d, 'anna', q, 'cs').state).toEqual({ kind: 'searching' });
        });
        it('11: truncated and a place missing → nothing', () => {
            const p = payload({ ...nothing, state: { on: true, search: 'done', truncated: true } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'silent' });
        });
        it('5: nothing found (done, unlocated, or missing without truncation)', () => {
            expect(computePersonHistory(d, 'anna', payload(nothing), 'cs').state).toEqual({ kind: 'none' });
            const p = payload({ events: [], places: { Lhota: { events: [], state: 'unlocated' }, 'Horní Lhota': { events: [] } } });
            expect(computePersonHistory(d, 'anna', p, 'cs').state).toEqual({ kind: 'none' });
        });
    });
});

describe('hide queue', () => {
    const p = payload({ events: [regionEvent('a-1', 1866)], places: { Lhota: { events: ['a-1'], also: ['Ellhota'] } } });
    it('an undo cancels a queued hiding of the same target that was not sent', () => {
        let q = queueHideOp([], { event: 'a-1', place: 'Lhota', at: AT }, p);
        expect(q).toHaveLength(1);
        q = queueHideOp(q, { event: 'a-1', place: 'Ellhota', do: 'show', at: AT }, p);
        expect(q).toEqual([]);
    });
    it('an undo of a confirmed hiding is queued and removes it from the effective list', () => {
        const confirmed = payload({ ...p, hidden: [{ event: 'a-1', place: 'Lhota' }] });
        const q = queueHideOp([], { event: 'a-1', place: 'Lhota', do: 'show', at: AT }, confirmed);
        expect(q).toHaveLength(1);
        expect(effectiveHidden(confirmed, q)).toEqual([]);
        expect(historyHiddenCount(confirmed)).toBe(1);
        expect(historyHiddenCount(confirmed, q)).toBe(0);
    });
    it('a queued hiding adds on top until it arrives in hidden; withdrawn events do not count', () => {
        const q = [{ event: 'a-1', personId: 'anna', at: AT }, { event: 'gone-1', place: 'Lhota', at: AT }];
        expect(effectiveHidden(p, q).map(h => h.queued)).toEqual([true, true]);
        expect(historyHiddenCount(p, q)).toBe(1);
    });
    it('sanitizes a stored queue', () => {
        expect(sanitizeHideQueue([{ event: 'a', place: 'L', at: AT }, { event: 'b', at: AT }, null, { event: 'c', personId: 'x', personRefn: 'P1', do: 'show', at: AT }]))
            .toEqual([{ event: 'a', place: 'L', at: AT }, { event: 'c', personId: 'x', personRefn: 'P1', do: 'show', at: AT }]);
    });
});

describe('year groups', () => {
    const anna = person('anna', { birthDate: '1838', birthPlace: 'Lhota', deathDate: '1900', deathPlace: 'Lhota' });
    const p = payload({
        events: [regionEvent('a-1', 1866), regionEvent('a-2', 1866, { kind: 'epidemic' }), localEvent('L1', 1866), localEvent('L2', 1880), regionEvent('a-3', 1890, { kind: 'war' })],
        places: { Lhota: { events: ['a-1', 'a-2', 'L1', 'L2', 'a-3'] } },
    });
    const items = computePersonHistory(data([anna]), 'anna', p, 'cs').items;
    it('clusters a year with two or more events', () => {
        const g = groupHistoryByYear(items);
        expect(g.map(x => [x.year, x.items.length, x.cluster, x.mark])).toEqual([
            [1866, 3, true, 'region'], [1880, 1, false, 'local'], [1890, 1, false, 'region'],
        ]);
    });
    it('always clusters when asked (phone held sideways)', () => {
        expect(groupHistoryByYear(items, true).every(x => x.cluster)).toBe(true);
    });
    it('labels a cluster with its count and the unique kinds in order', () => {
        const g = groupHistoryByYear(items);
        expect(historyClusterLabel(g[0].items, 'cs')).toBe('3 události: válka, epidemie, z pramenů');
        expect(historyClusterLabel(g[0].items, 'cs', true)).toBe('3 události');
        expect(historyClusterLabel(g[0].items, 'en')).toBe('3 events: war, epidemic, from records');
        expect(historyClusterLabel(g[1].items, 'cs')).toBe('Místní L2');
    });
});

describe('historySettingsStatus', () => {
    const base: HistorySettingsInput = {
        layerOn: true, linked: true, bridgeUp: true, payload: null,
        canLinkOn: false, canOff: false, canLinkOff: false,
        formatDate: iso => `D(${iso.slice(0, 10)})`, formatTime: iso => `T(${iso.slice(11, 16)})`,
    };
    const st = (state: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        payload({ state, ...extra });

    it('layer off: hidden, or "still searching" with the turn-off action', () => {
        expect(historySettingsStatus({ ...base, layerOn: false }, 'cs')).toBeNull();
        expect(historySettingsStatus({ ...base, layerOn: false, statusSearching: true, canOff: true }, 'cs'))
            .toEqual({ text: 'Výzkum u tohoto stromu události dál hledá.', action: 'off' });
        expect(historySettingsStatus({ ...base, layerOn: false, statusSearching: true, canLinkOff: true }, 'cs')!.action).toBe('linkOff');
        expect(historySettingsStatus({ ...base, layerOn: false, statusSearching: true }, 'cs')!.action).toBeNull();
        expect(historySettingsStatus({ ...base, layerOn: false, statusSearching: true, offDone: true }, 'cs')).toBeNull();
        expect(historySettingsStatus({ ...base, layerOn: false, statusSearching: true, canOff: true, offError: 'Disk je plný.' }, 'cs'))
            .toEqual({ text: 'Výzkum u tohoto stromu události dál hledá. Disk je plný.', action: null });
        expect(historySettingsStatus({ ...base, layerOn: false, bridgeUp: false, statusSearching: true }, 'cs')).toBeNull();
    });
    it('no research, no device', () => {
        expect(historySettingsStatus({ ...base, linked: false }, 'en')!.text).toBe('Events for places are found by the research. This tree is not linked to a research.');
        expect(historySettingsStatus({ ...base, bridgeUp: false }, 'cs')!.text).toMatch(/^Události k místům dodává výzkum/);
    });
    it('no search: link where announced, otherwise the sentence only', () => {
        const p = st({ on: false, search: 'none' });
        expect(historySettingsStatus({ ...base, payload: p, canLinkOn: true }, 'cs')).toEqual({ text: 'Výzkum události nehledá.', action: 'linkOn' });
        expect(historySettingsStatus({ ...base, payload: p }, 'cs')).toEqual({ text: 'Výzkum události nehledá. Hledání se zapíná ve výzkumu stromu.', action: null });
        // The live status wins: the payload says on, the status says off.
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'done' }), statusSearching: false, canLinkOn: true }, 'cs')!.action).toBe('linkOn');
    });
    it('waiting / archive: why + found kept, no link even when off', () => {
        const p = st({ on: false, search: 'waiting', why: 'výzkum je v archivu' });
        expect(historySettingsStatus({ ...base, payload: p, canLinkOn: true }, 'cs'))
            .toEqual({ text: 'Výzkum teď události nehledá: výzkum je v archivu. Nalezené události zůstávají.', action: null });
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'done' }), treeState: 'archive' }, 'en')!.text)
            .toBe('The research is not looking for events now. Events already found stay.');
    });
    it('running with pending, done with the date, truncated', () => {
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'running', pending: 3 }) }, 'cs')!.text)
            .toBe('Výzkum události hledá, 3 místa stromu ještě čekají.');
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'running', pending: 5 }) }, 'cs')!.text)
            .toBe('Výzkum události hledá, 5 míst stromu ještě čeká.');
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'done', at: AT }) }, 'cs')!.text)
            .toBe('Výzkum události hledá. Poslední hledání: D(2026-10-27).');
        expect(historySettingsStatus({ ...base, payload: st({ on: true, search: 'done', at: AT, truncated: true }) }, 'en')!.text)
            .toBe('The research looks for events. Last search: D(2026-10-27). The result is incomplete: only the places with the most facts came.');
    });
    it('bridge down: from the cache with "as of", no action', () => {
        const p = st({ on: false, search: 'none' });
        expect(historySettingsStatus({ ...base, bridgeUp: false, payload: p, canLinkOn: true }, 'cs'))
            .toEqual({ text: 'Výzkum události nehledá. Hledání se zapíná ve výzkumu stromu. Stav z T(14:05).', action: null });
    });
    it('bridge up without a payload (an older research): from the status', () => {
        expect(historySettingsStatus({ ...base, statusSearching: true }, 'cs')!.text).toBe('Výzkum události hledá.');
        expect(historySettingsStatus({ ...base }, 'cs')!.text).toBe('Výzkum události nehledá. Hledání se zapíná ve výzkumu stromu.');
    });
});

describe('historyHiddenList', () => {
    const anna = person('anna', { refn: 'P0012', firstName: 'Anna', birthDate: '1838', birthPlace: 'lhota', deathDate: '1900', deathPlace: 'Lhota' });
    const d = data([anna]);
    const p = payload({
        events: [regionEvent('a-1', 1880), regionEvent('a-2', 1866), localEvent('L1', 1870)],
        places: { Lhota: { events: ['a-1', 'a-2', 'L1'] }, Lhotka: { events: ['a-1'] } },
        hidden: [{ event: 'a-1', place: 'Lhota' }, { event: 'a-2', place: 'Lhota' }, { event: 'L1', person: 'P0012' }, { event: 'gone', place: 'Lhota' }, { event: 'a-1', place: 'Lhotka' }],
    });
    it('groups by the tree spelling of the place, by name then year; person hidings under their place; withdrawn left out', () => {
        const queue = [{ event: 'a-1', place: 'Lhotka', do: 'show' as const, at: AT }];
        const g = historyHiddenList(d, p, queue, 'cs');
        expect(g.map(x => x.place)).toEqual(['lhota']);
        expect(g[0].entries.map(e => [e.event.id, e.year, e.personId ?? null])).toEqual([
            ['a-2', 1866, null], ['L1', 1870, 'anna'], ['a-1', 1880, null],
        ]);
        const q2 = historyHiddenList(d, p, [{ event: 'a-2', place: 'Lhotka', at: AT }], 'cs');
        expect(q2.find(x => x.place === 'Lhotka')!.entries.map(e => [e.event.id, e.hide.queued])).toEqual([['a-2', true], ['a-1', false]]);
    });
});
