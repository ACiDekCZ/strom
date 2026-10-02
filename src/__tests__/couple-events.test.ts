/**
 * The couple's own events (data version 10): banns, a contract, a census of
 * the household… — Partnership.events. Each way out and back in keeps every
 * part of them (GEDCOM, JSON, the app's own copy), the privacy filters treat
 * them like the wedding, and everything that reads a couple (places, the map,
 * search, the life timeline, the family book, sources, merge, the tree check)
 * sees them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { validateJsonImport } from '../merge/validation.js';
import { validateTreeData } from '../validation.js';
import { applyLivingPrivacy, stripNotes, stripResearchWork, stripSources } from '../privacy.js';
import { collectPlaces } from '../places.js';
import { collectDatedPlacePoints } from '../map-time.js';
import { detailMatch, filterPersons } from '../search-filter.js';
import { computePersonLifeline } from '../timeline.js';
import { buildFamilyBook } from '../book.js';
import { mergePartnershipData } from '../merge/executor.js';
import { normalizeName } from '../merge/matching.js';
import { COUPLE_EVENT_TYPES, coupleEventTypeOfTag, sortCoupleEvents } from '../events.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import {
    CoupleEvent, Partnership, Person, StromData, TreeId, STROM_DATA_VERSION,
    toPartnershipId, toPersonId,
} from '../types.js';

const JAN = toPersonId('p_jan');
const MARIE = toPersonId('p_marie');
const UNION = toPartnershipId('u_jan_marie');

const BANNS: CoupleEvent = {
    id: 'ce_banns', type: 'banns', date: '1888-01-22', place: 'Dolní Lhota', address: 'čp. 7',
    ages: { [JAN]: '24 years', [MARIE]: '19 years' },
    participants: [
        { id: 'w1', role: 'witness', name: 'Josef Kříž' },
        { id: 'w2', role: 'witness', name: 'Václav Dvořák', note: 'soused' },
    ],
    sourceIds: ['s_banns'], note: 'Ohlášky třikrát.',
};

function tree(): StromData {
    const jan: Person = {
        id: JAN, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
        partnerships: [UNION], parentIds: [], childIds: [], birthDate: '1862', deathDate: '1919-03-12',
    };
    const marie: Person = {
        id: MARIE, firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', isPlaceholder: false,
        partnerships: [UNION], parentIds: [], childIds: [], deathDate: '>1919',
    };
    const union: Partnership = {
        id: UNION, person1Id: JAN, person2Id: MARIE, childIds: [], status: 'married',
        startDate: '1888-02-14', startPlace: 'Dolní Lhota',
        events: [
            { id: 'ce_custom', type: 'custom', customLabel: 'Křest dítěte manželů', sourceIds: ['s_mother'],
                note: 'Jméno dítěte ani datum na snímku nejsou.' },
            { id: 'ce_census', type: 'census', date: '1900', place: 'Horní Lhota', address: 'čp. 13' },
            structuredClone(BANNS),
            { id: 'ce_res', type: 'residence', date: '1890..1900', place: 'Horní Lhota', address: 'čp. 13' },
        ],
    };
    return {
        version: STROM_DATA_VERSION,
        persons: { [JAN]: jan, [MARIE]: marie },
        partnerships: { [UNION]: union },
        sources: {
            s_banns: { id: 's_banns', title: 'Oddací matrika Dolní Lhota', reference: 'fol. 3' },
            s_mother: { id: 's_mother', title: 'Rubrika matky' },
        },
    };
}

/** An event without its id, ages keyed by the partner's first name (ids differ after an import). */
function comparable(ev: CoupleEvent, data: StromData): object {
    const { id: _id, ages, sourceIds, participants, ...rest } = ev;
    return {
        ...rest,
        ...(ages ? { ages: Object.fromEntries(Object.entries(ages).map(([pid, a]) => [data.persons[pid as typeof JAN].firstName, a])) } : {}),
        ...(sourceIds ? { sources: sourceIds.map(s => data.sources![s].title) } : {}),
        ...(participants ? { participants: participants.map(({ id: _p, ...p }) => p) } : {}),
    };
}

describe('data version 10: the couple\'s events', () => {
    it('is the current version', () => {
        expect(STROM_DATA_VERSION).toBe(10);
    });

    it('has a GEDCOM tag for every type, read back as the same type', () => {
        const tags = { engagement: 'ENGA', banns: 'MARB', marriageLicence: 'MARL', marriageContract: 'MARC',
            marriageSettlement: 'MARS', residence: 'RESI', census: 'CENS', divorceFiled: 'DIVF',
            annulment: 'ANUL', custom: 'EVEN' } as const;
        for (const type of COUPLE_EVENT_TYPES) expect(coupleEventTypeOfTag(tags[type])).toBe(type);
    });

    it('sorts by date, equal dates by the type list, undated last in written order', () => {
        const events: CoupleEvent[] = [
            { id: 'a', type: 'custom', customLabel: 'X' },
            { id: 'b', type: 'census', date: '1900' },
            { id: 'c', type: 'residence', date: '1900' },
            { id: 'd', type: 'banns', date: '1888-01-22' },
            { id: 'e', type: 'annulment' },
            { id: 'f', type: 'residence', date: '1890..1900' },
        ];
        expect(sortCoupleEvents(events).map(e => e.id)).toEqual(['d', 'f', 'c', 'b', 'a', 'e']);
    });
});

describe('GEDCOM export → import', () => {
    const source = tree();
    const ged = exportToGedcom(source).content;
    const back = convertToStrom(parseGedcom(ged)).data;
    const union = Object.values(back.partnerships)[0];

    it('writes each event under its own tag, never into the couple\'s note', () => {
        expect(ged).toContain('1 MARB');
        expect(ged).toContain('1 CENS');
        expect(ged).toContain('1 RESI');
        expect(ged).toMatch(/1 EVEN\n2 TYPE Křest dítěte manželů/);
        expect(ged).toMatch(/2 HUSB\n3 AGE 24y\n2 WIFE\n3 AGE 19y/);
        expect(ged).toMatch(/2 _WITN Václav Dvořák\n3 RELA Witness\n3 NOTE soused/);
        expect(union.note).toBeUndefined();
    });

    it('brings every event back with all its parts', () => {
        const want = sortCoupleEvents(source.partnerships[UNION].events!).map(e => comparable(e, source));
        const got = sortCoupleEvents(union.events!).map(e => comparable(e, back));
        expect(got).toEqual(want);
    });

    it('keeps the citation\'s page on the source', () => {
        const banns = union.events!.find(e => e.type === 'banns')!;
        expect(back.sources![banns.sourceIds![0]].reference).toBe('fol. 3');
    });

    it('comes back as a valid tree', () => {
        expect(validateTreeData(back).issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('reads an engagement with only its tag, and a custom event\'s value as its name', () => {
        const text = ['0 HEAD', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME A /B/', '1 SEX M', '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME C /D/', '1 SEX F', '1 FAMS @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 ENGA Y', '1 EVEN Smír', '1 NCHI 4', '0 TRLR'].join('\n');
        const u = Object.values(convertToStrom(parseGedcom(text)).data.partnerships)[0];
        expect(u.events?.map(e => [e.type, e.customLabel])).toEqual([['engagement', undefined], ['custom', 'Smír']]);
        // The number of children is the one couple fact still kept as a note line.
        expect(u.note).toContain('4');
    });
});

describe('JSON and the app\'s own copy', () => {
    it('a JSON import keeps the events as they were', () => {
        const source = tree();
        const result = validateJsonImport(JSON.stringify(source));
        expect(result.valid).toBe(true);
        expect(result.data!.partnerships[UNION].events).toEqual(source.partnerships[UNION].events);
    });

    it('a JSON import drops a dead link to a person, keeping the written name', () => {
        const source = tree();
        source.partnerships[UNION].events![0].participants = [{ id: 'x', role: 'witness', personId: toPersonId('gone'), name: 'Old Name' }];
        const result = validateJsonImport(JSON.stringify(source));
        const part = result.data!.partnerships[UNION].events![0].participants![0];
        expect(part.personId).toBeUndefined();
        expect(part.name).toBe('Old Name');
    });

    it('the full copy carries them untouched', () => {
        const source = tree();
        const copy = applyLivingPrivacy(stripResearchWork(structuredClone(source)), 'full');
        expect(copy.partnerships[UNION].events).toEqual(source.partnerships[UNION].events);
    });
});

describe('privacy and export content', () => {
    it('a living couple loses its events like its wedding date', () => {
        const data = tree();
        delete data.persons[MARIE].deathDate;
        data.persons[MARIE].isDeceased = false;
        const out = applyLivingPrivacy(data, 'anonymous', 2026);
        expect(out.partnerships[UNION].events).toBeUndefined();
    });

    it('a privacy mode drops the events\' citations with the catalog, keeping the events', () => {
        const out = applyLivingPrivacy(tree(), 'anonymous', 2026);
        expect(out.partnerships[UNION].events).toHaveLength(4);
        expect(out.partnerships[UNION].events!.some(e => e.sourceIds)).toBe(false);
    });

    it('without notes / without sources strips them from the events too', () => {
        const noNotes = stripNotes(tree());
        expect(noNotes.partnerships[UNION].events!.some(e => e.note)).toBe(false);
        expect(noNotes.partnerships[UNION].events!.flatMap(e => e.participants ?? []).some(p => p.note)).toBe(false);
        const noSources = stripSources(tree());
        expect(noSources.partnerships[UNION].events!.some(e => e.sourceIds)).toBe(false);
    });
});

describe('what reads a couple sees its events', () => {
    it('places: a couple event\'s place belongs to both partners', () => {
        const places = collectPlaces(tree());
        const horni = [...places.values()].find(p => p.display === 'Horní Lhota')!;
        expect(horni.personIds.sort()).toEqual([JAN, MARIE].sort());
    });

    it('the map\'s time slider: a point for each partner, a range at its start', () => {
        const points = collectDatedPlacePoints(tree()).points.filter(p => p.year === 1890);
        expect(points.map(p => p.personId).sort()).toEqual([JAN, MARIE].sort());
    });

    it('search: the type, the house and the place find both partners', () => {
        const data = tree();
        expect(detailMatch(data.persons[JAN], 'banns', data)).toMatchObject({ label: 'Banns', value: 'Banns' });
        expect(detailMatch(data.persons[MARIE], normalizeName('čp. 13'), data)?.value).toBe('čp. 13');
        expect(filterPersons(data, { query: 'banns' }).sort()).toEqual([JAN, MARIE].sort());
    });

    it('the life timeline: each dated event, the other partner named, a range as its span', () => {
        const points = computePersonLifeline(tree(), JAN).filter(p => p.kind === 'coupleEvent');
        expect(points.map(p => [p.coupleType, p.yearLabel ?? p.year, p.relatedName])).toEqual([
            ['banns', 1888, 'Marie Dvořáková'],
            ['residence', '1890–1900', 'Marie Dvořáková'],
            ['census', 1900, 'Marie Dvořáková'],
        ]);
        expect(points[0].details?.age).toBe('24 years');
        expect(points[0].participants).toEqual(['Josef Kříž', 'Václav Dvořák']);
    });

    it('the family book: "Other events of the couple" under the wedding, citations as footnotes', () => {
        // A couple has a chapter of its own once it has a child.
        const withChild = (data: StromData): StromData => {
            const kid = toPersonId('p_kid');
            data.persons[kid] = { id: kid, firstName: 'Anna', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
                partnerships: [], parentIds: [JAN, MARIE], childIds: [], birthDate: '1889' };
            data.persons[JAN].childIds.push(kid);
            data.persons[MARIE].childIds.push(kid);
            data.partnerships[UNION].childIds.push(kid);
            return data;
        };
        const html = buildFamilyBook(withChild(tree()), { lang: 'en', privacyMode: 'full', dateLabel: 'x' });
        expect(html).toContain('Other events of the couple');
        expect(html).toContain('Banns, Dolní Lhota čp. 7. Witnesses Josef Kříž and Václav Dvořák (soused). Ohlášky třikrát.');
        expect(html).toMatch(/Křest dítěte manželů\. Jméno dítěte ani datum na snímku nejsou\.<sup class="book-fn-ref">\[\d\]<\/sup>/);
        expect(html.indexOf('Banns')).toBeLessThan(html.indexOf('Křest dítěte manželů'));
        const bare = withChild(tree());
        delete bare.partnerships[UNION].events;
        expect(buildFamilyBook(bare, { lang: 'en', privacyMode: 'full', dateLabel: 'x' })).not.toContain('Other events of the couple');
    });

    it('the tree check flags a dangling witness and a missing source on a couple event', () => {
        const data = tree();
        data.partnerships[UNION].events![0].participants = [{ id: 'x', role: 'witness', personId: toPersonId('gone') }];
        delete data.sources!.s_banns;
        const types = validateTreeData(data).issues.map(i => i.type);
        expect(types).toContain('orphanedParticipantRef');
        expect(types).toContain('citationMissingSource');
    });
});

describe('merge', () => {
    it('joins the incoming events, the same record once with both citations', () => {
        const existing = tree().partnerships[UNION];
        const incoming = tree().partnerships[UNION];
        incoming.events = [
            { ...structuredClone(BANNS), id: 'other_id', sourceIds: ['s_other'] },
            { id: 'ce_new', type: 'marriageContract', date: '1888-02-01', ages: { [JAN]: '24 years' } },
        ];
        const idMap = new Map([[JAN, toPersonId('p_jan_kept')]]);
        mergePartnershipData(existing, incoming, idMap, {});
        expect(existing.events).toHaveLength(5);
        expect(existing.events!.find(e => e.type === 'banns')!.sourceIds).toEqual(['s_banns', 's_other']);
        expect(existing.events!.find(e => e.type === 'marriageContract')!.ages).toEqual({ p_jan_kept: '24 years' });
    });
});

describe('DataManager', () => {
    const TREE = 'couple-events-tree' as TreeId;

    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as {
            data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
        };
        dm.data = tree();
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('adds, edits and removes an event, each one undo step', () => {
        const ev = DataManager.addCoupleEvent(UNION, { type: 'marriageLicence', date: '1888-01-30' })!;
        expect(DataManager.getCoupleEvent(UNION, ev.id)?.type).toBe('marriageLicence');
        expect(DataManager.updateCoupleEvent(UNION, ev.id, { place: 'Čáslav', date: undefined })).toBe(true);
        expect(DataManager.getCoupleEvent(UNION, ev.id)).toMatchObject({ place: 'Čáslav' });
        expect(DataManager.getCoupleEvent(UNION, ev.id)?.date).toBeUndefined();
        DataManager.undo();
        expect(DataManager.getCoupleEvent(UNION, ev.id)?.date).toBe('1888-01-30');
        expect(DataManager.removeCoupleEvent(UNION, ev.id)).toBe(true);
        expect(DataManager.getCoupleEvent(UNION, ev.id)).toBeNull();
        DataManager.undo();
        expect(DataManager.getCoupleEvent(UNION, ev.id)).not.toBeNull();
    });

    it('rejects a custom event without its name and a type a couple has not', () => {
        expect(DataManager.addCoupleEvent(UNION, { type: 'custom' })).toBeNull();
        expect(DataManager.addCoupleEvent(UNION, { type: 'baptism' as CoupleEvent['type'] })).toBeNull();
    });

    it('cites and uncites; the source lists and counts the citation; removing the source removes it', () => {
        expect(DataManager.citeCoupleEvent(UNION, 'ce_census', 's_mother')).toBe(true);
        expect(DataManager.countSourceCitations('s_mother')).toBe(2);
        expect(DataManager.listSourceCitations('s_banns')).toEqual([{ kind: 'coupleEvent', partnershipId: UNION, eventId: 'ce_banns' }]);
        expect(DataManager.unciteCoupleEvent(UNION, 'ce_census', 's_mother')).toBe(true);
        DataManager.removeSource('s_banns');
        expect(DataManager.getCoupleEvent(UNION, 'ce_banns')?.sourceIds).toBeUndefined();
    });

    it('deleting a witness who is in the tree keeps their name on the event', () => {
        const witness = DataManager.createPerson({ firstName: 'Josef', lastName: 'Kříž', gender: 'male' });
        DataManager.updateCoupleEvent(UNION, 'ce_census', { participants: [{ id: 'w', role: 'witness', personId: witness.id }] });
        DataManager.deletePerson(witness.id);
        expect(DataManager.getCoupleEvent(UNION, 'ce_census')?.participants?.[0]).toMatchObject({ name: 'Josef Kříž' });
        expect(DataManager.getCoupleEvent(UNION, 'ce_census')?.participants?.[0].personId).toBeUndefined();
    });
});
