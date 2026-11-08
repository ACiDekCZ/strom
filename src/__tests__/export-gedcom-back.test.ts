/**
 * The GEDCOM export of spec 066 §4–§5: "Back to {prog}" content, the
 * deceased's sources kept under every privacy choice, what a choice leaves
 * out of the sources (droppedSources), and the research's facts marked with
 * a NOTE. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { applyContentOptions, applyLivingPrivacy, CONTENT_PRESETS, countCitations, countLivingPersons, droppedSources, matchContentPreset } from '../privacy.js';
import { exportToGedcom, firstResearchNoteSource, researchNoteSource } from '../ged-exporter.js';
import { strings } from '../strings.js';
import { Person, StromData } from '../types.js';

/** The fixture's people by their plain ids. */
const people = (d: StromData) => d.persons as unknown as Record<string, Person>;

const NOW = 2026;

/**
 * A deceased man (two citations), a living couple (three citations of the
 * husband, one of the marriage). Sources: s1 (deceased only), s2 (deceased
 * and living), s3 (living only), s4 (the living couple's marriage only).
 */
function tree(): StromData {
    return {
        version: 11,
        persons: {
            d1: {
                id: 'd1', firstName: 'Quorvel', lastName: 'Harrowfield', gender: 'male',
                birthDate: '1850-03-01', deathDate: '1920-11-02', isPlaceholder: false,
                birthSourceIds: ['s1'], sourceIds: ['s2'],
                photo: 'data:image/jpeg;base64,' + 'Q'.repeat(400),
                partnerships: [], parentIds: [], childIds: ['l1'],
            },
            l1: {
                id: 'l1', firstName: 'Tobiah', lastName: 'Harrowfield', gender: 'male',
                birthDate: '1980-05-05', isPlaceholder: false,
                sourceIds: ['s2', 's3'],
                events: [{ id: 'e1', type: 'occupation', value: 'Cooper', sourceIds: ['s3'] }],
                partnerships: ['u1'], parentIds: ['d1'], childIds: [],
            },
            l2: {
                id: 'l2', firstName: 'Mirabeth', lastName: 'Thornquist', gender: 'female',
                birthDate: '1982', isPlaceholder: false,
                partnerships: ['u1'], parentIds: [], childIds: [],
            },
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'l1', person2Id: 'l2', status: 'married',
                startDate: '2008-06-14', sourceIds: ['s4'], childIds: [],
            },
        },
        sources: {
            s1: { id: 's1', title: 'Baptisms Harrowmoor 1840-1860', reference: 'p. 41' },
            s2: { id: 's2', title: 'Census Harrowmoor 1900' },
            s3: { id: 's3', title: 'Guild roll of coopers' },
            s4: { id: 's4', title: 'Civil marriages Thornby 2008' },
        },
    } as unknown as StromData;
}

describe('CONTENT_PRESETS.back', () => {
    it('keeps notes, sources and citations, no photos, attachments or source images', () => {
        expect(CONTENT_PRESETS.back).toEqual({ photos: false, attachments: false, notes: true, sources: true, sourceImages: 'none' });
    });

    it('is not one of the Content section\'s buttons', () => {
        expect(matchContentPreset(CONTENT_PRESETS.back)).not.toBe('back');
    });

    it('leaves no data URL in the file and every source in it', () => {
        const ged = exportToGedcom(applyLivingPrivacy(tree(), 'full', NOW, { keepDeceasedSources: true }), 'T', { content: CONTENT_PRESETS.back }).content;
        expect(ged).not.toContain('data:');
        for (const n of [1, 2, 3, 4]) expect(ged).toContain(`0 @S${n}@ SOUR`);
        expect((ged.match(/^\d SOUR @S\d@$/gm) ?? []).length).toBe(countCitations(tree()));
    });
});

describe('droppedSources', () => {
    it('without "Sources & citations": every source and citation, whatever the privacy', () => {
        for (const privacy of ['full', 'initials', 'anonymous', 'minimal'] as const) {
            expect(droppedSources(tree(), privacy, { sources: false }, NOW)).toEqual({ sources: 4, citations: 6 });
        }
    });

    it('Full data with sources: nothing', () => {
        expect(droppedSources(tree(), 'full', { sources: true }, NOW)).toEqual({ sources: 0, citations: 0 });
    });

    it('a privacy mode: the living\'s citations and the sources only they cite', () => {
        for (const privacy of ['initials', 'anonymous', 'minimal'] as const) {
            expect(droppedSources(tree(), privacy, { sources: true }, NOW)).toEqual({ sources: 2, citations: 4 });
        }
    });

    it('a tree without sources: nothing', () => {
        const data = tree();
        delete data.sources;
        for (const p of Object.values(data.persons)) { delete p.sourceIds; delete p.birthSourceIds; delete p.events; }
        delete (data.partnerships as unknown as Record<string, { sourceIds?: string[] }>).u1.sourceIds;
        expect(droppedSources(data, 'initials', { sources: false }, NOW)).toEqual({ sources: 0, citations: 0 });
        expect(droppedSources(data, 'initials', { sources: true }, NOW)).toEqual({ sources: 0, citations: 0 });
    });

    it('does not touch the tree', () => {
        const data = tree();
        const before = JSON.stringify(data);
        droppedSources(data, 'initials', { sources: true }, NOW);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('counts the living people', () => {
        expect(countLivingPersons(tree(), NOW)).toBe(2);
    });
});

describe('GEDCOM under a privacy choice keeps the deceased\'s sources', () => {
    for (const privacy of ['initials', 'anonymous'] as const) {
        it(`${privacy}: the deceased keeps SOUR and citations, the living lose theirs`, () => {
            const ged = exportToGedcom(applyLivingPrivacy(tree(), privacy, NOW, { keepDeceasedSources: true }), 'T').content;
            const records = ged.split(/\n(?=0 )/);
            const deceased = records.find(r => r.includes('Quorvel'))!;
            expect(deceased).toMatch(/1 BIRT[\s\S]*2 SOUR @S\d@/);
            expect(deceased).toMatch(/^1 SOUR @S\d@$/m);
            const living = records.filter(r => /^0 @I\d@ INDI/.test(r) && !r.includes('Quorvel'));
            expect(living).toHaveLength(2);
            for (const r of living) expect(r).not.toMatch(/SOUR/);
            for (const r of records.filter(r => /^0 @F\d@ FAM/.test(r))) expect(r).not.toMatch(/SOUR/);
            // The catalog keeps the two sources the deceased cites.
            expect(records.filter(r => /^0 @S\d@ SOUR/.test(r)).length).toBe(2);
            expect(ged).toContain('Baptisms Harrowmoor 1840-1860');
            expect(ged).not.toContain('Guild roll of coopers');
        });
    }
});

describe('research facts marked with a NOTE', () => {
    function researchTree(): StromData {
        const data = tree();
        const d1 = people(data).d1 as unknown as Record<string, unknown>;
        d1.deathSourceIds = ['s2'];
        d1.researchOrigins = {
            // Origin names two records: both in the note, joined.
            birth: { kind: 'research', sourceIds: ['s1', 's2'] },
            // Corrected (earlier value kept): the fact's own citation.
            death: { kind: 'import', importId: 'I1', was: { value: '1921' } },
            // No NOTE under SEX.
            sex: { kind: 'research', sourceIds: ['s1'] },
            // From the family tree, untouched by the research: no note.
            name: { kind: 'import', importId: 'I1' },
        };
        return data;
    }
    const opts = { content: CONTENT_PRESETS.back };

    it('writes one NOTE under each research fact with its record(s)', () => {
        const data = researchTree();
        const ged = exportToGedcom(data, 'T', { ...opts, researchNote: strings.exportGed.noteText }).content;
        expect(ged).toContain('2 NOTE Derived by the Strom research (per: Baptisms Harrowmoor 1840-1860, p. 41; Census Harrowmoor 1900)');
        expect(ged).toContain('2 NOTE Derived by the Strom research (per: Census Harrowmoor 1900)');
        expect((ged.match(/Derived by the Strom research/g) ?? []).length).toBe(2);
        const birth = /1 BIRT\n(?:[2-9] .*\n)*/.exec(ged)![0];
        expect(birth).toContain('2 NOTE Derived by the Strom research (per: Baptisms Harrowmoor');
    });

    it('writes no NOTE without the choice', () => {
        const ged = exportToGedcom(researchTree(), 'T', opts).content;
        expect(ged).not.toContain('Strom research');
    });

    it('the example is the first research fact\'s record(s); none without research facts', () => {
        const data = researchTree();
        expect(firstResearchNoteSource(data)).toBe('Baptisms Harrowmoor 1840-1860, p. 41; Census Harrowmoor 1900');
        expect(researchNoteSource(data, people(data).d1, 'name')).toBeNull();
        expect(firstResearchNoteSource(tree())).toBeNull();
    });

    it('a research fact without any record in the tree gets no note', () => {
        const data = tree();
        (people(data).l2 as unknown as Record<string, unknown>).researchOrigins = { birth: { kind: 'research' } };
        expect(firstResearchNoteSource(data)).toBeNull();
        expect(exportToGedcom(data, 'T', { ...opts, researchNote: () => 'MARK' }).content).not.toContain('MARK');
    });

    it('the note text is in the app\'s language', () => {
        expect(strings.exportGed.noteText('X')).toBe('Derived by the Strom research (per: X)');
        // Content options alone never add one.
        expect(exportToGedcom(applyContentOptions(researchTree(), CONTENT_PRESETS.back), 'T').content).not.toContain('NOTE Derived');
    });
});
