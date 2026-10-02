/**
 * The new version of an approved story (Strom Research _STORY > _DRAFT):
 * read beside the approved text, from research files only, never in a copy
 * that leaves the app; the links that decide it and the waiting item.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { applyContentOptions } from '../privacy.js';
import { researchSchemeUrl, sanitizeWaiting } from '../research-link.js';
import { Person, StromData } from '../types.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const head = (research: boolean): string => `0 HEAD
1 CHAR UTF-8
${research ? `1 SOUR STROM_RESEARCH\n1 _STROM_TREE ${TREE}\n1 _STROM_ASOF 2026-10-02\n` : ''}`;

const story = (stat: string) => `1 _STORY
2 TYPE vypraveni
2 TITL Mlynář z Lhoty
2 STAT ${stat}
2 TEXT Jan byl mlynář.
2 DATA OCCU mlynář [S0001]
2 _DRAFT
3 TITL Mlynář z Horní Lhoty
3 TEXT Jan byl mlynář ve Lhotě, jako jeho ot
4 CONC ec.
4 CONT
4 CONT Mlýn vyhořel roku 1856.
3 DATA OCCU mlynář [S0001]
3 DATA
4 TEXT EVEN požár 1856 [S0007]
3 NOTE Požár je z kroniky obce.
3 _AT 2026-10-02
`;

const body = (stat: string) => `0 @I1@ INDI
1 NAME Jan /Vlk/
1 SEX M
1 REFN P0001
2 TYPE strom-research
1 FAMS @F1@
${story(stat)}0 @I2@ INDI
1 NAME Marie /Vlková/
1 SEX F
1 REFN P0002
2 TYPE strom-research
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
${story(stat)}0 TRLR
`;

const load = (research: boolean, stat = 'hotovo'): StromData => convertToStrom(parseGedcom(head(research) + body(stat))).data;
const jan = (d: StromData): Person => Object.values(d.persons).find(p => p.refn === 'P0001')!;
const couple = (d: StromData) => Object.values(d.partnerships)[0]!;

describe('reading _DRAFT', () => {
    it('keeps the approved story as the story and the new version beside it', () => {
        const s = jan(load(true)).story!;
        expect(s.status).toBe('final');
        expect(s.title).toBe('Mlynář z Lhoty');
        expect(s.text).toBe('Jan byl mlynář.');
        expect(s.facts).toEqual(['OCCU mlynář [S0001]']);
        expect(s.draft).toEqual({
            title: 'Mlynář z Horní Lhoty',
            text: 'Jan byl mlynář ve Lhotě, jako jeho otec.\n\nMlýn vyhořel roku 1856.',
            facts: ['OCCU mlynář [S0001]', 'EVEN požár 1856 [S0007]'],
            note: 'Požár je z kroniky obce.',
            at: '2026-10-02',
        });
    });

    it('reads a couple\'s new version the same way', () => {
        expect(couple(load(true)).story?.draft?.text).toMatch(/^Jan byl mlynář ve Lhotě/);
    });

    it('ignores it under a draft story (a draft is simply rewritten)', () => {
        const s = jan(load(true, 'navrh')).story!;
        expect(s.status).toBe('draft');
        expect(s.text).toBe('Jan byl mlynář.');
        expect(s.draft).toBeUndefined();
    });

    it('trusts it from the research\'s own files only', () => {
        const s = jan(load(false)).story!;
        expect(s.text).toBe('Jan byl mlynář.');
        expect(s.draft).toBeUndefined();
    });

    it('does not let the draft\'s lines leak into the approved story', () => {
        const s = jan(load(true)).story!;
        expect(s.note).toBeUndefined();
        expect(s.text).not.toContain('Lhotě');
    });
});

describe('a copy that leaves the app', () => {
    it('carries the approved story without the new version', () => {
        const out = applyContentOptions(load(true), false);
        expect(jan(out).story?.text).toBe('Jan byl mlynář.');
        expect(jan(out).story?.draft).toBeUndefined();
        expect(couple(out).story?.draft).toBeUndefined();
    });

    it('never writes _DRAFT to GEDCOM', () => {
        const research = exportToGedcom(load(true), 'Test', { research: { id: TREE } }).content;
        const plain = exportToGedcom(load(true), 'Test').content;
        for (const ged of [research, plain]) {
            expect(ged).toContain('2 STAT hotovo');
            expect(ged).not.toContain('_DRAFT');
            expect(ged).not.toContain('Horní Lhoty');
        }
    });

    it('leaves the tree itself untouched', () => {
        const data = load(true);
        applyContentOptions(data, false);
        expect(jan(data).story?.draft).toBeDefined();
    });
});

describe('deciding it in the research', () => {
    const t = `tree=${TREE}`;

    it('takes the new version or keeps the approved one', () => {
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', storyDo: 'final' })).toBe(`strom-research://story?${t}&person=P0001&do=final`);
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', storyDo: 'keep' })).toBe(`strom-research://story?${t}&person=P0001&do=keep`);
    });

    it('names a couple by both partners', () => {
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', partner: 'P0002', storyDo: 'keep' }))
            .toBe(`strom-research://story?${t}&person=P0001&partner=P0002&do=keep`);
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', partner: 'P0001' })).toBeNull();
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', partner: 'Marie' })).toBeNull();
    });

    it('refuses anything else', () => {
        expect(researchSchemeUrl('story', { tree: TREE, person: 'P0001', storyDo: 'drop' as never })).toBeNull();
    });
});

describe('the waiting item', () => {
    it('knows a story by its kind and whose it is', () => {
        expect(sanitizeWaiting([
            { id: 'P0001', kind: 'story', what: 'Nová verze vyprávění', person: 'P0001' },
            { id: 'F0001', kind: 'story', what: 'Nová verze vyprávění', person: 'P0001', partner: 'P0002' },
        ])).toEqual([
            { id: 'P0001', what: 'Nová verze vyprávění', on: '', at: '', person: 'P0001', kind: 'story' },
            { id: 'F0001', what: 'Nová verze vyprávění', on: '', at: '', person: 'P0001', kind: 'story', partner: 'P0002' },
        ]);
    });

    it('treats a story without its person, or an unknown kind, as a plain item', () => {
        const [a, b] = sanitizeWaiting([
            { id: 'X', kind: 'story', what: 'Nová verze vyprávění' },
            { id: 'T0001', kind: 'mystery', what: 'Úkol', person: 'P0001', partner: 'P0002' },
        ]);
        expect(a.kind).toBeUndefined();
        expect(b.kind).toBeUndefined();
        expect(b.partner).toBeUndefined();
    });
});
