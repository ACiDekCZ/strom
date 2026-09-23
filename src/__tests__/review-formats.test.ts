/**
 * Import / export / merge / share findings of the 2026-09-22 review (wave 1,
 * section C). Invented data only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom, parseGedcomDate, gedcomDatePhrase } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import {
    normalizeName, stringSimilarity, quickMatchScore, createMergeState,
    updateMatchDecision, reanalyzeMatches, calculateMergeStats, findMatches,
} from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { buildChangePacket, applyPacketOntoData, summarizeChangePacket } from '../share-diff.js';
import { extractSubtree } from '../subtree.js';
import { StorageManager } from '../storage.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender } from '../types.js';
import { strings } from '../strings.js';

// ---------- helpers ----------

type PersonOverrides = Partial<Omit<Person, 'partnerships' | 'parentIds' | 'childIds'>> & {
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};
function P(id: string, first: string, last: string, o: PersonOverrides = {}): Person {
    const { partnerships, parentIds, childIds, ...rest } = o;
    return {
        id: id as PersonId, firstName: first, lastName: last,
        gender: (o.gender as Gender) ?? 'male', isPlaceholder: false,
        partnerships: (partnerships ?? []) as PartnershipId[],
        parentIds: (parentIds ?? []) as PersonId[],
        childIds: (childIds ?? []) as PersonId[],
        ...rest,
    };
}
function U(id: string, p1: string, p2: string, childIds: string[], o: Partial<Partnership> = {}): Partnership {
    return {
        id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId,
        childIds: childIds as PersonId[], status: 'married', ...o,
    };
}
function tree(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const conv = (text: string) => convertToStrom(parseGedcom(text));
const GED = (body: string) => `0 HEAD\n1 CHAR UTF-8\n${body}\n0 TRLR`;
const byFirst = (d: StromData, first: string): Person => {
    const p = Object.values(d.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
};
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

// ---------- K5 ----------

describe('K5: names in every script', () => {
    it('keeps Cyrillic, Greek and CJK letters and folds ł/ß/ø/æ/đ', () => {
        expect(normalizeName('Иван Петров')).toBe('иван петров');
        expect(normalizeName('Νίκος')).toBe('νικος');
        expect(normalizeName('王小明')).toBe('王小明');
        expect(normalizeName('Łukasz Łysy')).toBe('lukasz lysy');
        expect(normalizeName('Straße')).toBe('strasse');
        expect(normalizeName('Søren Æbelø')).toBe('soren aebelo');
        expect(normalizeName('Đorđe')).toBe('dorde');
    });

    it('an empty name is no name: similarity 0, never equal', () => {
        expect(stringSimilarity('', '')).toBe(0);
        expect(stringSimilarity('???', '!!')).toBe(0);
    });

    it('two different Cyrillic names do not match; Łukasz Łysy = Lukasz Lysy', () => {
        const existing = tree([P('e1', 'Иван', 'Петров', { birthDate: '1900' })]);
        const incoming = tree([P('i1', 'Сергей', 'Смирнов', { birthDate: '1900' })]);
        expect(findMatches(existing, incoming)).toHaveLength(0);
        expect(quickMatchScore(existing.persons['e1' as PersonId], incoming.persons['i1' as PersonId])).toBe(0);

        const e2 = tree([P('e2', 'Łukasz', 'Łysy', { birthDate: '1900-03-04' })]);
        const i2 = tree([P('i2', 'Lukasz', 'Lysy', { birthDate: '1900-03-04' })]);
        const m = findMatches(e2, i2);
        expect(m).toHaveLength(1);
        expect(m[0].confidence).toBe('high');
    });

    it('the same Cyrillic name still matches', () => {
        const e = tree([P('e1', 'Иван', 'Петров', { birthDate: '1900-01-02' })]);
        const i = tree([P('i1', 'Иван', 'Петров', { birthDate: '1900-01-02' })]);
        expect(findMatches(e, i)[0]?.existingId).toBe('e1');
    });
});

// ---------- V16 ----------

describe('V16: a rejected match is added as new after re-analysis', () => {
    it('stays in unmatchedIncoming and is added by the merge', async () => {
        const existing = tree([P('e1', 'Jan', 'Novák', { birthDate: '1900-01-01' }), P('e2', 'Karel', 'Dvořák', { birthDate: '1910' })]);
        const incoming = tree([P('i1', 'Jan', 'Novák', { birthDate: '1900-01-01' }), P('i2', 'Karel', 'Dvořák', { birthDate: '1910' })]);
        const state = createMergeState(existing, incoming);
        expect(state.matches.map(m => m.incomingId)).toContain('i1');
        updateMatchDecision(state, 'i1' as PersonId, 'reject');
        updateMatchDecision(state, 'i2' as PersonId, { type: 'manual_match', targetId: 'e2' as PersonId });
        reanalyzeMatches(state);
        expect(state.unmatchedIncoming).toContain('i1');
        expect(calculateMergeStats(state).willAdd).toBe(1);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        expect(Object.values(result.mergedData.persons).filter(p => p.firstName === 'Jan')).toHaveLength(2);
    });
});

// ---------- V14 / V15 / S6 (merge executor) ----------

describe('V14: merging into an existing partnership', () => {
    it('unions children, witnesses (remapped) and story', async () => {
        const existing = tree([
            P('eD', 'Josef', 'Novák', { birthDate: '1880-01-01', partnerships: ['eU'], childIds: ['eA'] }),
            P('eM', 'Anna', 'Nováková', { gender: 'female', birthDate: '1885-02-02', partnerships: ['eU'], childIds: ['eA'] }),
            P('eA', 'Adam', 'Novák', { birthDate: '1910-03-03', parentIds: ['eD', 'eM'] }),
        ], [U('eU', 'eD', 'eM', ['eA'])]);
        const incoming = tree([
            P('iD', 'Josef', 'Novák', { birthDate: '1880-01-01', partnerships: ['iU'], childIds: ['iB'] }),
            P('iM', 'Anna', 'Nováková', { gender: 'female', birthDate: '1885-02-02', partnerships: ['iU'], childIds: ['iB'] }),
            P('iB', 'Bohumil', 'Novák', { birthDate: '1912-04-04', parentIds: ['iD', 'iM'] }),
            P('iW', 'Václav', 'Svědek', { birthDate: '1870-05-05' }),
        ], [U('iU', 'iD', 'iM', ['iB'], {
            status: 'divorced',
            participants: [{ id: 'w1', role: 'witness', personId: 'iW' as PersonId }],
            story: { text: 'Svatba v zimě.' },
        })]);
        const state = createMergeState(existing, incoming);
        const result = await executeMerge(state);
        const d = result.mergedData;
        const union = d.partnerships['eU' as PartnershipId];
        const bohumil = byFirst(d, 'Bohumil');
        const witness = byFirst(d, 'Václav');
        expect(union.childIds).toContain(bohumil.id);
        expect(union.childIds).toContain('eA');
        expect(union.participants?.[0].personId).toBe(witness.id);
        expect(union.story?.text).toBe('Svatba v zimě.');
        // Status difference: the existing tree's status is kept.
        expect(union.status).toBe('married');
    });
});

describe('V15: merging the same GEDCOM twice does not double its content', () => {
    it('events, sources and attachments are recognised by content', async () => {
        const file = GED([
            '0 @S1@ SOUR', '1 TITL Matrika N 1', '1 REPO @R1@', '1 PAGE fol. 3',
            '0 @R1@ REPO', '1 NAME SOA Praha',
            '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M',
            '1 BIRT', '2 DATE 1 JAN 1900', '2 PLAC Lhota',
            '1 BAPM', '2 DATE 2 JAN 1900', '2 PLAC Lhota', '2 SOUR @S1@',
            '1 OCCU kovář',
            '1 OBJE', '2 FORM jpeg', '2 TITL scan', '2 FILE data:image/jpeg;base64,AAAA',
        ].join('\n'));
        const first = conv(file).data;
        const second = conv(file).data;
        const state = createMergeState(first, second);
        const result = await executeMerge(state);
        const d = result.mergedData;
        const jan = byFirst(d, 'Jan');
        expect(jan.events?.filter(e => e.type === 'baptism')).toHaveLength(1);
        expect(jan.events?.filter(e => e.type === 'occupation')).toHaveLength(1);
        expect(jan.attachments).toHaveLength(1);
        expect(Object.keys(d.sources ?? {})).toHaveLength(1);
        const srcId = Object.keys(d.sources!)[0];
        expect(jan.events?.find(e => e.type === 'baptism')?.sourceIds).toEqual([srcId]);
    });
});

describe('S6: wedding witnesses never dangle after merge or split', () => {
    it('a new partnership remaps witness ids; a subtree keeps the name', async () => {
        const existing = tree([P('x', 'Xaver', 'Jiný', { birthDate: '1800' })]);
        const incoming = tree([
            P('a', 'Adam', 'Král', { birthDate: '1850', partnerships: ['u'] }),
            P('b', 'Bára', 'Králová', { gender: 'female', birthDate: '1852', partnerships: ['u'] }),
            P('w', 'Wenzel', 'Zeuge', { birthDate: '1840' }),
        ], [U('u', 'a', 'b', [], { participants: [{ id: 'p1', role: 'witness', personId: 'w' as PersonId }] })]);
        const result = await executeMerge(createMergeState(existing, incoming));
        const d = result.mergedData;
        const union = Object.values(d.partnerships)[0];
        expect(union.participants?.[0].personId).toBe(byFirst(d, 'Wenzel').id);

        const sub = extractSubtree(d, new Set([byFirst(d, 'Adam').id, byFirst(d, 'Bára').id]));
        const part = Object.values(sub.partnerships)[0].participants![0];
        expect(part.personId).toBeUndefined();
        expect(part.name).toBe('Wenzel Zeuge');
    });
});

// ---------- K6 ----------

describe('K6: accepting a change packet applies per field', () => {
    function shared(): { full: StromData; baseline: StromData } {
        const full = tree([
            P('D', 'Dana', 'Nová', {
                gender: 'female', birthDate: '1900', deathPlace: 'Brno',
                photo: 'data:image/jpeg;base64,PHOTO', sourceIds: ['s1'],
            }),
        ]);
        full.sources = { s1: { id: 's1', title: 'Matrika' } };
        // What was shared: privacy/content filtered — no photo, no citations.
        const baseline = clone(full);
        delete baseline.persons['D' as PersonId].photo;
        delete baseline.persons['D' as PersonId].sourceIds;
        delete baseline.sources;
        return { full, baseline };
    }

    it('a death-place edit keeps the photo and the citations', () => {
        const { full, baseline } = shared();
        const relative = clone(baseline);
        relative.persons['D' as PersonId].deathPlace = 'Olomouc';
        const packet = buildChangePacket(baseline, relative, { baseExportId: 'X' });
        const out = applyPacketOntoData(full, packet);
        const d = out.persons['D' as PersonId];
        expect(d.deathPlace).toBe('Olomouc');
        expect(d.photo).toBe('data:image/jpeg;base64,PHOTO');
        expect(d.sourceIds).toEqual(['s1']);
        expect(out.sources?.s1).toBeDefined();
    });

    it('a child added locally after sharing survives with symmetric links', () => {
        const { full, baseline } = shared();
        // Local edit after sharing: a child C of D, and a changed birth date.
        full.persons['C' as PersonId] = P('C', 'Cyril', 'Nový', { parentIds: ['D'] });
        full.persons['D' as PersonId].childIds = ['C' as PersonId];
        full.persons['D' as PersonId].birthDate = '1901';
        const relative = clone(baseline);
        relative.persons['D' as PersonId].deathPlace = 'Olomouc';
        const packet = buildChangePacket(baseline, relative, { baseExportId: 'X' });
        const out = applyPacketOntoData(full, packet);
        expect(out.persons['D' as PersonId].childIds).toEqual(['C']);
        expect(out.persons['C' as PersonId].parentIds).toEqual(['D']);
        // The sender did not touch the birth date: the local edit stays.
        expect(out.persons['D' as PersonId].birthDate).toBe('1901');
    });

    it('a child the relative adds gets both sides of the link', () => {
        const { full, baseline } = shared();
        const relative = clone(baseline);
        relative.persons['K' as PersonId] = P('K', 'Kamil', 'Nový', { parentIds: ['D'] });
        relative.persons['D' as PersonId].childIds = ['K' as PersonId];
        const packet = buildChangePacket(baseline, relative, { baseExportId: 'X' });
        const out = applyPacketOntoData(full, packet);
        expect(out.persons['D' as PersonId].childIds).toEqual(['K']);
        expect(out.persons['K' as PersonId].parentIds).toEqual(['D']);
        expect(out.persons['D' as PersonId].photo).toBeDefined();
    });

    it('an older packet without baselines never deletes fields', () => {
        const { full, baseline } = shared();
        const relative = clone(baseline);
        relative.persons['D' as PersonId].deathPlace = 'Olomouc';
        const packet = buildChangePacket(baseline, relative, { baseExportId: 'X' });
        delete packet.persons.changedBase;
        const out = applyPacketOntoData(full, packet);
        expect(out.persons['D' as PersonId].deathPlace).toBe('Olomouc');
        expect(out.persons['D' as PersonId].photo).toBeDefined();
        expect(out.persons['D' as PersonId].sourceIds).toEqual(['s1']);
    });

    it('the preview is empty once the packet is applied (filtered fields notwithstanding)', () => {
        const { full, baseline } = shared();
        const relative = clone(baseline);
        relative.persons['D' as PersonId].deathPlace = 'Olomouc';
        const packet = buildChangePacket(baseline, relative, { baseExportId: 'X' });
        expect(summarizeChangePacket(full, packet).hasEffect).toBe(true);
        const applied = applyPacketOntoData(full, packet);
        expect(summarizeChangePacket(applied, packet).hasEffect).toBe(false);
    });
});

// ---------- GEDCOM import ----------

describe('V13: a surname alone is a person, not a placeholder', () => {
    it('imports /Nováková/ as a real person', () => {
        const d = conv(GED('0 @I1@ INDI\n1 NAME /Nováková/\n1 SEX F\n1 BIRT\n2 DATE 1995')).data;
        const p = Object.values(d.persons)[0];
        expect(p.isPlaceholder).toBe(false);
        expect(p.lastName).toBe('Nováková');
        const empty = conv(GED('0 @I1@ INDI\n1 NAME //\n1 SEX F')).data;
        expect(Object.values(empty.persons)[0].isPlaceholder).toBe(true);
    });
});

describe('V17: shared NOTE records', () => {
    it('resolves NOTE pointers on people, families, events and sources', () => {
        const d = conv(GED([
            '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 NOTE @N1@',
            '1 BAPM', '2 DATE 1900', '2 NOTE @N2@', '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME Eva /Nová/', '1 SEX F', '1 FAMS @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 NOTE @N1@',
            '0 @S1@ SOUR', '1 TITL Kniha', '1 NOTE @N2@',
            '0 @N1@ NOTE Sdílená poznámka', '1 CONT druhý řá', '1 CONC dek a konec',
            '0 @N2@ NOTE Křest v kostele',
        ].join('\n')));
        const jan = byFirst(d.data, 'Jan');
        expect(jan.notes).toBe('Sdílená poznámka\ndruhý řádek a konec');
        expect(jan.events?.[0].note).toBe('Křest v kostele');
        expect(Object.values(d.data.partnerships)[0].note).toBe('Sdílená poznámka\ndruhý řádek a konec');
        expect(Object.values(d.data.sources!)[0].note).toBe('Křest v kostele');
        expect(d.stats.droppedTagSummary).toBe('');
        expect(JSON.stringify(d.data)).not.toContain('@N1@');
    });
});

describe('S10: date phrases', () => {
    it('INT with a phrase keeps the date, approximate, and the words', () => {
        expect(parseGedcomDate('INT 1900 (per census)')).toBe('~1900');
        expect(gedcomDatePhrase('INT 1900 (per census)')).toBe('INT 1900 (per census)');
        expect(parseGedcomDate('(about Easter 1900)')).toBe('');
        expect(gedcomDatePhrase('(about Easter 1900)')).toBe('about Easter 1900');
    });

    it('an unknown month never becomes January: the year alone is kept', () => {
        expect(parseGedcomDate('3 XYZ 1900')).toBe('1900');
        expect(gedcomDatePhrase('3 XYZ 1900')).toBe('3 XYZ 1900');
        expect(parseGedcomDate('3 JUN 1900')).toBe('1900-06-03');
        expect(gedcomDatePhrase('3 JUN 1900')).toBeNull();
    });

    it('the phrase lands in the fact note', () => {
        const d = conv(GED('0 @I1@ INDI\n1 NAME Jan /Novák/\n1 SEX M\n1 BAPM\n2 DATE INT 1900 (per census)')).data;
        const ev = byFirst(d, 'Jan').events![0];
        expect(ev.date).toBe('~1900');
        expect(ev.note).toBe(strings.gedcomNotes.datePhrase('INT 1900 (per census)'));
    });
});

describe('S11 / S14: family structure', () => {
    it('a child linked only by FAMC is the family\'s child', () => {
        const d = conv(GED([
            '0 @I1@ INDI', '1 NAME Otec /A/', '1 SEX M', '1 FAMS @F1@',
            '0 @I2@ INDI', '1 NAME Matka /A/', '1 SEX F', '1 FAMS @F1@',
            '0 @I3@ INDI', '1 NAME Dite /A/', '1 SEX M', '1 FAMC @F1@',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        ].join('\n'))).data;
        expect(byFirst(d, 'Dite').parentIds).toHaveLength(2);
        expect(Object.values(d.partnerships)[0].childIds).toEqual([byFirst(d, 'Dite').id]);
    });

    it('a family with children but no parents keeps them siblings', () => {
        const d = conv(GED([
            '0 @I1@ INDI', '1 NAME Petr /B/', '1 SEX M',
            '0 @I2@ INDI', '1 NAME Pavla /B/', '1 SEX F',
            '0 @F1@ FAM', '1 CHIL @I1@', '1 CHIL @I2@',
        ].join('\n'))).data;
        const petr = byFirst(d, 'Petr');
        const pavla = byFirst(d, 'Pavla');
        expect(petr.parentIds).toHaveLength(2);
        expect(pavla.parentIds).toEqual(petr.parentIds);
        expect(petr.parentIds.every(id => d.persons[id].isPlaceholder)).toBe(true);
    });

    it('duplicate CHIL lines and a second FAM of the same couple are one union', () => {
        const d = conv(GED([
            '0 @I1@ INDI', '1 NAME Otec /C/', '1 SEX M',
            '0 @I2@ INDI', '1 NAME Matka /C/', '1 SEX F',
            '0 @I3@ INDI', '1 NAME Prvni /C/', '1 SEX M',
            '0 @I4@ INDI', '1 NAME Druhy /C/', '1 SEX M',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I3@', '1 MARR', '2 DATE 1900',
            '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I4@', '1 MARR', '2 PLAC Lhota',
        ].join('\n'))).data;
        const unions = Object.values(d.partnerships);
        expect(unions).toHaveLength(1);
        expect(unions[0].childIds).toHaveLength(2);
        expect(unions[0].startDate).toBe('1900');
        expect(unions[0].startPlace).toBe('Lhota');
        expect(byFirst(d, 'Otec').partnerships).toHaveLength(1);
        expect(byFirst(d, 'Otec').childIds).toHaveLength(2);
    });
});

describe('S12: a single-parent family keeps witnesses and story', () => {
    it('reads MARR witnesses and _STORY', () => {
        const d = conv(GED([
            '0 @I1@ INDI', '1 NAME Anna /D/', '1 SEX F',
            '0 @I2@ INDI', '1 NAME Syn /D/', '1 SEX M',
            '0 @F1@ FAM', '1 WIFE @I1@', '1 CHIL @I2@',
            '1 MARR', '2 _WITN Jan Svědek', '1 _STORY', '2 TEXT Příběh rodiny.',
        ].join('\n'))).data;
        const union = Object.values(d.partnerships)[0];
        expect(union.participants?.[0].name).toBe('Jan Svědek');
        expect(union.story?.text).toBe('Příběh rodiny.');
    });
});

describe('S17: nothing dropped silently', () => {
    it('an inline SOUR becomes a source; EVEN keeps its value; ABBR titles; DATA is reported', () => {
        const r = conv(GED([
            '0 @I1@ INDI', '1 NAME Jan /E/', '1 SEX M',
            '1 SOUR Vzpomínky babičky, sepsané 1950 v Lho', '2 CONC tě',
            '1 EVEN Velký požár', '2 TYPE Neštěstí', '2 DATE 1905',
            '1 BAPM', '2 SOUR Farní kniha',
            '0 @S1@ SOUR', '1 ABBR Kniha zemřelých', '1 DATA', '2 EVEN DEAT',
        ].join('\n')));
        const jan = byFirst(r.data, 'Jan');
        const titles = Object.values(r.data.sources!).map(s => s.title).sort();
        expect(titles).toEqual(['Farní kniha', 'Kniha zemřelých', 'Vzpomínky babičky, sepsané 1950 v Lhotě']);
        expect(jan.sourceIds).toHaveLength(1);
        const custom = jan.events!.find(e => e.type === 'custom')!;
        expect(custom.customLabel).toBe('Neštěstí');
        expect(custom.note).toBe('Velký požár');
        expect(jan.events!.find(e => e.type === 'baptism')!.sourceIds).toHaveLength(1);
        expect(r.stats.droppedTagSummary).toContain('DATA ×1');
    });
});

describe('embedded media types', () => {
    it('only raster images (and PDFs for documents) are imported', () => {
        const r = conv(GED([
            '0 @I1@ INDI', '1 NAME Jan /F/', '1 SEX M',
            '1 OBJE', '2 FORM svg', '2 _STROM_KIND photo', '2 FILE data:image/svg+xml;base64,PHN2Zz4=',
            '1 OBJE', '2 FORM html', '2 FILE data:text/html;base64,PGI+',
            '1 OBJE', '2 FORM pdf', '2 FILE data:application/pdf;base64,JVBERi0=',
            '1 OBJE', '2 FORM png', '2 _STROM_KIND photo', '2 FILE data:image/png;base64,iVBORw==',
        ].join('\n')));
        const jan = byFirst(r.data, 'Jan');
        expect(jan.photo).toBe('data:image/png;base64,iVBORw==');
        expect(jan.attachments?.map(a => a.mimeType)).toEqual(['application/pdf']);
        expect(r.stats.skippedMedia).toBe(2);
    });
});

// ---------- GEDCOM round-trip ----------

describe('export -> import round-trip', () => {
    function roundTrip(d: StromData): StromData {
        return conv(exportToGedcom(d, 'Test').content).data;
    }

    it('V18: deceased without a date and the open question survive', () => {
        const d = tree([P('a', 'Jan', 'Novák', { isDeceased: true, question: 'Kdy zemřel?\nA kde?' })]);
        const back = byFirst(roundTrip(d), 'Jan');
        expect(back.isDeceased).toBe(true);
        expect(back.question).toBe('Kdy zemřel?\nA kde?');
    });

    it('S13: partners and separated keep their status', () => {
        const d = tree([
            P('a', 'Adam', 'A', { partnerships: ['u1', 'u2'] }),
            P('b', 'Bára', 'B', { gender: 'female', partnerships: ['u1'] }),
            P('c', 'Cecílie', 'C', { gender: 'female', partnerships: ['u2'] }),
        ], [
            U('u1', 'a', 'b', [], { status: 'partners', startDate: '1990' }),
            U('u2', 'a', 'c', [], { status: 'separated', startDate: '1995', endDate: '1999' }),
        ]);
        const back = roundTrip(d);
        const statusOf = (first: string) => Object.values(back.partnerships)
            .find(u => back.persons[u.person2Id].firstName === first || back.persons[u.person1Id].firstName === first)!;
        expect(statusOf('Bára').status).toBe('partners');
        expect(statusOf('Bára').startDate).toBe('1990');
        expect(statusOf('Cecílie').status).toBe('separated');
        expect(statusOf('Cecílie').endDate).toBe('1999');
    });

    it('military service and a step link to both parents survive', () => {
        const d = tree([
            P('f', 'Otec', 'G', { partnerships: ['u'], childIds: ['c'] }),
            P('m', 'Matka', 'G', { gender: 'female', partnerships: ['u'], childIds: ['c'] }),
            P('c', 'Dite', 'G', {
                parentIds: ['f', 'm'],
                parentRelTypes: { ['f' as PersonId]: 'step', ['m' as PersonId]: 'step' },
                events: [{ id: 'e1', type: 'military', date: '1914', note: 'pěchota' }],
            }),
        ], [U('u', 'f', 'm', ['c'])]);
        const back = roundTrip(d);
        const child = byFirst(back, 'Dite');
        expect(child.events?.[0].type).toBe('military');
        expect(child.events?.[0].note).toBe('pěchota');
        expect(Object.values(child.parentRelTypes ?? {})).toEqual(['step', 'step']);
    });

    it('S15: every physical line fits 255 bytes and long values come back whole', () => {
        const longPlace = 'Nová Ves u Českých Budějovic, okres Český Krumlov, kraj Jihočeský, '.repeat(5).trim();
        const longName = 'Žofie Marie Terezie Anna Kateřina Ludmila '.repeat(5).trim();
        const longWitness = 'Václav Kovář, soused, rolník z čp. 12 v Horní Lhotě, '.repeat(6).trim();
        const d = tree([
            P('a', longName, 'Nováková', {
                gender: 'female', birthPlace: longPlace, partnerships: ['u'],
                sourceIds: ['s1'], nameVariants: [longName + ' /Nová/'],
            }),
            P('b', 'Jan', 'Novák', { partnerships: ['u'] }),
        ], [U('u', 'b', 'a', [], { participants: [{ id: 'w', role: 'witness', name: longWitness }] })]);
        d.sources = { s1: { id: 's1', title: 'Kniha', reference: 'fol. 12, '.repeat(40).trim(), url: 'https://example.org/' + 'x'.repeat(400) } };
        const text = exportToGedcom(d, 'Test').content;
        for (const line of text.split('\n')) expect(byteLen(line)).toBeLessThanOrEqual(255);
        const back = roundTrip(d);
        const a = back.persons[Object.keys(back.persons).find(id => back.persons[id as PersonId].lastName === 'Nováková') as PersonId];
        expect(a.firstName).toBe(longName);
        expect(a.birthPlace).toBe(longPlace);
        expect(Object.values(back.partnerships)[0].participants?.[0].name).toBe(longWitness);
        const src = Object.values(back.sources!)[0];
        expect(src.reference).toBe(d.sources.s1.reference);
        expect(src.url).toBe(d.sources.s1.url);
    });

    it('S16: content options leave the embedded media out', () => {
        const d = tree([P('a', 'Jan', 'Novák', {
            photo: 'data:image/jpeg;base64,AAAA',
            attachments: [{ id: 'x', name: 'scan', mimeType: 'image/png', dataUrl: 'data:image/png;base64,BBBB', sizeBytes: 3 }],
        })]);
        const full = exportToGedcom(d).content;
        expect(full).toContain('base64');
        const lean = exportToGedcom(d, undefined, {
            content: { photos: false, attachments: false, notes: true, sources: true },
        }).content;
        expect(lean).not.toContain('base64');
        expect(lean).not.toContain('OBJE');
    });
});
