/**
 * The sample tree: valid data, full layout coverage (every person as focus,
 * both display modes — mirrors the etalon harness), one family for every
 * language with the words translated, and the cases it is there to show.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getDemoTree, DEMO_FOCUS, DemoImageMaker } from '../demo-tree.js';
import { customCardSize, cardPreset, cardLines } from '../card-fields.js';
import { validateTreeData, stripUnsafeMediaDataUrls } from '../validation.js';
import { collectPlaces } from '../places.js';
import { checkRecordedAge } from '../recorded-age.js';
import { parseFlexDate } from '../dates.js';
import { setLanguage } from '../strings.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { assertNoNodeOverlap, assertValidPositions } from '../layout/__tests__/helpers/assertions.js';
import { auditGeometry } from '../layout/__tests__/helpers/geometryAudit.js';
import { PersonId, DEFAULT_LAYOUT_CONFIG } from '../types.js';

// The default card, and the Register card the sample opens with (five lines).
const CONFIGS = [
    { name: 'normal card', config: DEFAULT_LAYOUT_CONFIG },
    { name: 'sample card', config: { ...DEFAULT_LAYOUT_CONFIG, ...customCardSize(cardPreset('register').on.length) } },
];
const MODES = [
    { name: 'standard', displayPolicy: { mode: 'standard' as const, autoExpand: false } },
    { name: 'expanded', displayPolicy: { mode: 'standard' as const, autoExpand: true } },
];
const id = (key: string) => `demo_${key}` as PersonId;

afterEach(() => setLanguage('en'));

describe('sample tree', () => {
    const data = getDemoTree();
    const personIds = Object.keys(data.persons) as PersonId[];

    it('has the details the Register card it opens with shows (each event with its date and place)', () => {
        const register = cardPreset('register');
        const lines = cardLines(data.persons[DEMO_FOCUS], data, register);
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(lines.every(l => !!l.date && !!l.place)).toBe(true);
    });

    it('passes validateTreeData with no errors', () => {
        const result = validateTreeData(data);
        const errors = result.issues.filter(i => i.severity === 'error');
        expect(errors, JSON.stringify(errors)).toEqual([]);
        expect(result.valid).toBe(true);
    });

    for (const personId of personIds) {
        const name = `${data.persons[personId].firstName} (${personId})`;
        for (const { name: card, config } of CONFIGS) for (const mode of MODES) {
            it(`layout is clean with ${name} as focus [${mode.name}, ${card}]`, () => {
                const result = runLayoutPipeline({
                    data,
                    focusPersonId: personId,
                    config,
                    ancestorDepth: 5,
                    descendantDepth: 5,
                    includeSpouseAncestors: true,
                    includeParentSiblings: true,
                    includeParentSiblingDescendants: true,
                    displayPolicy: mode.displayPolicy,
                });
                assertValidPositions(result.positions);
                assertNoNodeOverlap(result.positions, config.cardWidth, config.cardHeight);
                const hard = auditGeometry(result, config, data).filter(v => v.type !== 'inherent-crossing');
                expect(hard.map(v => `[${v.type}] ${v.detail}`), `${personId} [${mode.name}, ${card}]`).toEqual([]);
            });
        }
    }
});

describe('one sample for every language', () => {
    it('has the same people and places, the words in the UI language', () => {
        setLanguage('en');
        const en = getDemoTree();
        setLanguage('cs');
        const cs = getDemoTree();
        setLanguage('de');
        const de = getDemoTree();
        expect(Object.keys(cs.persons)).toEqual(Object.keys(en.persons));
        expect(Object.keys(de.persons)).toEqual(Object.keys(en.persons));
        expect(cs.persons[DEMO_FOCUS].firstName).toBe('Johan');
        expect(cs.places).toEqual(en.places);
        expect(en.persons[DEMO_FOCUS].deathCause).toBe('Pneumonia');
        expect(cs.persons[DEMO_FOCUS].deathCause).toBe('Zápal plic');
        expect(de.persons[DEMO_FOCUS].deathCause).toBe('Lungenentzündung');
        expect(cs.persons[DEMO_FOCUS].deathAge).toBe('75 let');
        // The record's own words stay as written.
        expect(cs.sources!.demo_src_death.transcript).toBe(en.sources!.demo_src_death.transcript);
    });

    it('is deterministic', () => {
        expect(JSON.stringify(getDemoTree())).toBe(JSON.stringify(getDemoTree()));
    });
});

describe('what the sample shows', () => {
    const data = getDemoTree();
    const persons = Object.values(data.persons);
    const unions = Object.values(data.partnerships);

    it('every kind of relationship, an adoption and a parent the record does not name', () => {
        expect(new Set(unions.map(u => u.status))).toEqual(new Set(['married', 'divorced', 'separated', 'partners']));
        expect(Object.values(data.persons[id('alma')].parentRelTypes ?? {})).toEqual(['adoptive', 'adoptive']);
        expect(data.persons[id('ida_father')].isPlaceholder).toBe(true);
        expect(data.persons[id('erik')].partnerships).toHaveLength(2);
    });

    it('dates as registers give them', () => {
        const qualifiers = new Set(persons.flatMap(p => [p.birthDate, p.deathDate])
            .map(d => parseFlexDate(d))
            .filter(Boolean)
            .map(d => d!.end ? 'range' : d!.qualifier || (d!.day ? 'day' : d!.month ? 'month' : 'year')));
        expect(qualifiers).toEqual(new Set(['~', '<', '>', 'range', 'day', 'month', 'year']));
    });

    it('a recorded age that disagrees with the dates, and one that agrees', () => {
        const johan = data.persons[DEMO_FOCUS];
        expect(checkRecordedAge(johan.deathAge, johan.birthDate, johan.deathDate)?.differs).toBeTruthy();
        const laura = data.persons[id('laura')];
        expect(checkRecordedAge(laura.deathAge, laura.birthDate, laura.deathDate)?.differs).toBeFalsy();
    });

    it('godparents, witnesses, register entries, a story and an open question', () => {
        const johan = data.persons[DEMO_FOCUS];
        const baptism = johan.events!.find(e => e.type === 'baptism')!;
        expect(baptism.participants!.map(p => p.personId ?? p.name)).toEqual(['Ole Dahl', id('kari')]);
        const wedding = data.partnerships[johan.partnerships[0]];
        expect(wedding.participants).toHaveLength(2);
        expect(Object.keys(wedding.ages ?? {})).toHaveLength(2);
        expect(johan.birthSourceIds).toEqual(['demo_src_baptism']);
        expect(Object.values(data.sources!).every(s => s.transcript)).toBe(true);
        expect(johan.story?.status).toBe('final');
        expect(persons.some(p => p.question)).toBe(true);
        expect(data.surnameVariants).toEqual([['Berg', 'Bergh']]);
    });

    it('every place it names is on the map, every cited source exists', () => {
        for (const key of collectPlaces(data).keys()) expect(data.places?.[key], key).toBeDefined();
        const cited = [
            ...persons.flatMap(p => [...(p.sourceIds ?? []), ...(p.birthSourceIds ?? []), ...(p.deathSourceIds ?? []),
                ...(p.events ?? []).flatMap(e => e.sourceIds ?? [])]),
            ...unions.flatMap(u => u.sourceIds ?? []),
        ];
        for (const s of cited) expect(data.sources?.[s], s).toBeDefined();
    });

    it('has living people for the privacy options', () => {
        expect(persons.filter(p => !p.deathDate && !p.isPlaceholder && parseFlexDate(p.birthDate)!.year > 1940).length)
            .toBeGreaterThanOrEqual(5);
    });
});

describe('sample pictures', () => {
    const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(64);
    const maker: DemoImageMaker = {
        entry: () => ({
            page: { dataUrl: jpeg, width: 1000, height: 1300, sizeBytes: 48 },
            excerpt: { dataUrl: jpeg, width: 920, height: 132, sizeBytes: 48 },
            region: { x: 0.04, y: 0.5, w: 0.92, h: 0.1 },
        }),
        portrait: () => jpeg,
    };

    it('comes without pictures when nothing can draw them', () => {
        const data = getDemoTree();
        expect(Object.values(data.persons).some(p => p.photo || p.attachments)).toBe(false);
        expect(Object.values(data.sources!).some(s => s.excerpts)).toBe(false);
    });

    it('carries the drawn portraits, the page and the crops linked to it', () => {
        const data = getDemoTree(maker);
        expect(Object.values(data.persons).filter(p => p.photo)).toHaveLength(3);
        const page = data.persons[DEMO_FOCUS].attachments![0];
        expect(page.sourceId).toBe('demo_src_baptism');
        const crop = data.sources!.demo_src_baptism.excerpts![0];
        expect(crop.fromAttachmentId).toBe(page.id);
        expect(Object.values(data.sources!).filter(s => s.excerpts)).toHaveLength(3);
        // The loader's safety pass keeps them all.
        expect(stripUnsafeMediaDataUrls(data)).toBe(0);
        expect(validateTreeData(data).valid).toBe(true);
    });
});
