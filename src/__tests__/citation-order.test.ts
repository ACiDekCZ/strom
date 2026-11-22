/**
 * The order of a fact's citations (spec 095 K1.1): the main citation, the
 * primary record of the event (the record of its own kind, an original,
 * written within 12 months), the other originals, the rest by QUAY, then the
 * source's number and the list's order. The same rule as Strom Research's
 * `core/citeorder.ts`. Also the gates of the main citation, the removal and
 * the file's order by the research's features. Invented data.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    cleanSourceEvents, cleanTreeSourceEvents, citationFact, dateMonths, monthsApart, orderedCitationSteps, orderedCitations,
    orderedCitationsAt, recordOfFact, sourceNumbers,
} from '../citation-order.js';
import {
    CITATIONS_MAIN_FEATURE, CITATIONS_ORDER_FEATURE, CITATIONS_REMOVE_FEATURE, citationFileOrder, citationMainOffered,
    citationRemoveTaken, researchTakes, setCitationFeaturesLookup,
} from '../citation-gates.js';
import { TreeManager } from '../tree-manager.js';
import { Person, Source, StromData, TreeId, TreeMetadata } from '../types.js';
import { toPartnershipId, toPersonId } from '../ids.js';

const P = toPersonId('p_zbyhnev');
const U = toPartnershipId('u_zbyhnev');

const src = (id: string, extra: Partial<Source> = {}): Source => ({ id, title: `Record ${id}`, ...extra });

/** The four registers of a parish and a census, each numbered as the research numbers them. */
function sources(): Record<string, Source> {
    return {
        census: src('census', { refn: 'S0001', events: ['CENS'], quality: 3, recordDate: '1857-12-31' }),
        deaths: src('deaths', { refn: 'S0002', events: ['DEAT', 'BURI'], quality: 3, recordDate: '1900-05-03' }),
        marriages: src('marriages', { refn: 'S0003', events: ['MARR'], quality: 3, recordDate: '1846-02-10' }),
        births: src('births', { refn: 'S0004', events: ['BIRT', 'CHR'], quality: 3, recordDate: '1821-03-04' }),
    };
}

function person(extra: Partial<Person> = {}): Person {
    return {
        id: P, firstName: 'Zbyhněv', lastName: 'Vlnka', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [],
        birthDate: '1821-03-02', deathDate: '1900-05-01', ...extra,
    };
}

function tree(p: Person, srcs: Record<string, Source> = sources()): StromData {
    return { persons: { [P]: p }, partnerships: {}, sources: srcs };
}

const order = (data: StromData, ref: Parameters<typeof orderedCitationsAt>[1], opts = {}) =>
    orderedCitationsAt(data, ref, opts).map(c => `${c.id}:${c.step}`);

describe('K1.1 order of a fact\'s citations', () => {
    const all = ['census', 'deaths', 'marriages', 'births'];

    it('a birth cited by every register: the birth register first, the rest by number', () => {
        const data = tree(person({ birthSourceIds: [...all], deathSourceIds: [...all] }));
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['births:2', 'census:5', 'deaths:5', 'marriages:5']);
        // The death's own record is the death register.
        expect(order(data, { personId: P, fact: 'death' })).toEqual(['deaths:2', 'census:5', 'marriages:5', 'births:5']);
        // The stored list is left as it was.
        expect(data.persons[P].birthSourceIds).toEqual(all);
    });

    it('the main citation goes first, before the primary record', () => {
        const data = tree(person({ birthSourceIds: [...all], citationMain: { birthSourceIds: 'census' } }));
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['census:1', 'births:2', 'deaths:5', 'marriages:5']);
    });

    it('a main citation of a source no longer in the list is no main citation', () => {
        const data = tree(person({ birthSourceIds: ['census', 'births'], citationMain: { birthSourceIds: 'deaths' } }));
        expect(orderedCitations(data, data.persons[P] as never, 'birthSourceIds', { tag: 'BIRT', date: '1821' })).toEqual(['births', 'census']);
    });

    it('the record is written at most 12 months from the fact', () => {
        const at = (recordDate: string) => {
            const srcs = sources();
            srcs.births.recordDate = recordDate;
            return order(tree(person({ birthSourceIds: ['census', 'births'] }), srcs), { personId: P, fact: 'birth' })[0];
        };
        expect(at('1822-03')).toBe('births:2');     // 12 months
        expect(at('1822-04')).toBe('census:5');     // 13 months: an original like the census, its number first
        expect(at('1820-03')).toBe('births:2');     // 12 months before
    });

    it('dates as loosely as they are written: about, before, after, between', () => {
        const first = (birthDate: string, recordDate: string) => {
            const srcs = sources();
            srcs.births.recordDate = recordDate;
            return order(tree(person({ birthDate, birthSourceIds: ['census', 'births'] }), srcs), { personId: P, fact: 'birth' })[0];
        };
        expect(first('~1821', '1823-12')).toBe('births:2');    // about: two years either side
        expect(first('~1821', '1825-06')).toBe('census:5');
        expect(first('<1821', '1805')).toBe('births:2');       // before: twenty years before
        expect(first('<1821', '1799')).toBe('census:5');
        expect(first('>1821', '1840')).toBe('births:2');       // after: twenty years after
        expect(first('1818..1820', '1821-06')).toBe('births:2'); // between: both ends
        expect(first('1818..1820', '1822-02')).toBe('census:5');
        // A date that cannot be read does not decide.
        expect(first('in the spring', '1950')).toBe('births:2');
        expect(dateMonths('1821')).toEqual({ min: 1821 * 12, max: 1821 * 12 + 11 });
        expect(monthsApart('1821-03', '1822-03')).toBe(12);
        expect(monthsApart('1821', '1821-06')).toBe(0);
        expect(monthsApart('nonsense', '1821')).toBeUndefined();
    });

    it('a record without a date is a primary record after the dated ones; the earlier written first', () => {
        const srcs = sources();
        srcs.baptisms = src('baptisms', { refn: 'S0005', events: ['BAPM'], quality: 3 });
        srcs.copy = src('copy', { refn: 'S0006', events: ['BIRT'], quality: 3, recordDate: '1821-09' });
        srcs.births.recordDate = '1821-03-04';
        const data = tree(person({ birthSourceIds: ['baptisms', 'copy', 'census', 'births'] }), srcs);
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['births:2', 'copy:2', 'baptisms:2', 'census:5']);
    });

    it('the citation\'s own QUAY decides, then QUAY highest first, none after 0', () => {
        const srcs = sources();
        srcs.a = src('a', { refn: 'S0010', quality: 1 });
        srcs.b = src('b', { refn: 'S0011' });
        srcs.c = src('c', { refn: 'S0012', quality: 0 });
        srcs.d = src('d', { refn: 'S0013', quality: 2 });
        // The birth register cited as a copy (QUAY 2) here: no primary record.
        const data = tree(person({ birthSourceIds: ['b', 'c', 'a', 'births', 'd'], citationQuay: { birthSourceIds: { births: 2 } } }), srcs);
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['births:5', 'd:4', 'a:4', 'c:4', 'b:5']);
    });

    it('a source without a number after the numbered ones, then the list\'s order', () => {
        const srcs: Record<string, Source> = {
            x: src('x', { quality: 2 }), y: src('y', { refn: 'S0090', quality: 2 }), z: src('z', { quality: 2 }),
        };
        const data = tree(person({ birthSourceIds: ['x', 'z', 'y'] }), srcs);
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['y:5', 'x:5', 'z:5']);
    });

    it('a page of a numbered record (an import\'s source per place cited) takes the record\'s number', () => {
        const srcs: Record<string, Source> = {
            a: src('a', { refn: 'S0007', quality: 2, repository: 'Archive' }),
            page: { id: 'page', title: 'Record b', quality: 2, repository: 'Archive' },
            b: src('b', { refn: 'S0003', quality: 2, repository: 'Archive' }),
        };
        expect(sourceNumbers(srcs).get('page')).toBe(3);
        const data = tree(person({ birthSourceIds: ['a', 'page', 'b'] }), srcs);
        expect(order(data, { personId: P, fact: 'birth' })).toEqual(['page:5', 'b:5', 'a:5']);
    });

    it('the file\'s order: nothing sorted, only the main citation first', () => {
        const data = tree(person({ birthSourceIds: [...all] }));
        expect(order(data, { personId: P, fact: 'birth' }, { fileOrder: true })).toEqual(['census:5', 'deaths:5', 'marriages:5', 'births:5']);
        data.persons[P].citationMain = { birthSourceIds: 'marriages' };
        expect(order(data, { personId: P, fact: 'birth' }, { fileOrder: true })).toEqual(['marriages:1', 'census:5', 'deaths:5', 'births:5']);
    });

    it('a couple\'s wedding, a person\'s event and a person\'s own citations', () => {
        const p = person({
            sourceIds: ['census', 'marriages'],
            events: [{ id: 'ev_bur', type: 'burial', date: '1900-05-04', sourceIds: ['census', 'deaths'] }],
        });
        const data: StromData = {
            persons: { [P]: p },
            partnerships: { [U]: { id: U, person1Id: P, person2Id: P, childIds: [], status: 'married', startDate: '1846-02-10', sourceIds: ['births', 'marriages'] } },
            sources: sources(),
        };
        expect(order(data, { partnershipId: U })).toEqual(['marriages:2', 'births:5']);
        expect(order(data, { personId: P, eventId: 'ev_bur' })).toEqual(['deaths:2', 'census:5']);
        // No fact: no primary record, never a main citation.
        expect(citationFact(data, { personId: P })?.isFact).toBe(false);
        expect(order(data, { personId: P })).toEqual(['census:5', 'marriages:5']);
        expect(citationFact(data, { personId: P, eventId: 'missing' })).toBeNull();
    });

    it('which records record which facts', () => {
        expect(recordOfFact({ events: ['CHR'] }, 'BIRT')).toBe(true);
        expect(recordOfFact({ events: ['BURI'] }, 'DEAT')).toBe(true);
        expect(recordOfFact({ events: ['MARR'] }, 'MARB')).toBe(true);
        expect(recordOfFact({ events: ['BIRT'] }, 'DEAT')).toBe(false);
        expect(recordOfFact({ events: ['BIRT'] }, 'OCCU')).toBeUndefined();
        expect(recordOfFact({}, 'BIRT')).toBeUndefined();
        // The computation keeps a list as given.
        const ids = ['b', 'a'];
        const holder = { sourceIds: ids };
        orderedCitationSteps({ sources: {} }, holder, 'sourceIds');
        expect(holder.sourceIds).toBe(ids);
        expect(ids).toEqual(['b', 'a']);
    });
});

describe('Source.events as stored (data v21)', () => {
    it('only tags in upper case, each once', () => {
        expect(cleanSourceEvents(['BIRT', 'birt', 'CHR', 'BIRT', 7, '', 'MARR '])).toEqual(['BIRT', 'CHR']);
        expect(cleanSourceEvents('BIRT')).toBeUndefined();
        expect(cleanSourceEvents([])).toBeUndefined();
        const srcs = { a: src('a', { events: ['x'] as string[] }), b: src('b', { events: ['DEAT'] }) };
        cleanTreeSourceEvents(srcs);
        expect('events' in srcs.a).toBe(false);
        expect(srcs.b.events).toEqual(['DEAT']);
    });
});

describe('citation gates by the research\'s features', () => {
    const TREE = 'tree-gates' as TreeId;
    afterEach(() => {
        vi.restoreAllMocks();
        setCitationFeaturesLookup(() => null);
    });
    const linked = (research?: { id: string }) => vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue(
        { id: TREE, name: 'T', ...(research ? { research: { id: research.id, fingerprint: 'f', syncedAt: '2026-11-01' } } : {}) } as unknown as TreeMetadata);

    it('a tree without a research marks a main citation; nothing to take a removal; its own order', () => {
        linked();
        expect(citationMainOffered(TREE)).toBe(true);
        expect(citationRemoveTaken(TREE)).toBe(false);
        expect(citationFileOrder(TREE)).toBe(false);
    });

    it('a research\'s tree: what the bridge says it takes', () => {
        linked({ id: 'r1' });
        setCitationFeaturesLookup(() => null);
        expect(citationMainOffered(TREE)).toBe(false);
        setCitationFeaturesLookup(id => id === 'r1' ? ['origin.ids'] : null);
        expect(citationMainOffered(TREE)).toBe(false);
        setCitationFeaturesLookup(id => id === 'r1' ? [CITATIONS_MAIN_FEATURE, CITATIONS_REMOVE_FEATURE, CITATIONS_ORDER_FEATURE] : null);
        expect(citationMainOffered(TREE)).toBe(true);
        expect(citationRemoveTaken(TREE)).toBe(true);
        expect(citationFileOrder(TREE)).toBe(true);
        expect(researchTakes(undefined, CITATIONS_MAIN_FEATURE)).toBe(false);
    });
});
