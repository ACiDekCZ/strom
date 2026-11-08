/**
 * The reliability marks as HTML (spec 066 §2): the pill's glyphs and classes,
 * its title (a partial import, the family tree's note, the research's note),
 * where the person card shows the marks ("same marks" rule) and the tree
 * card's mini mark. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import {
    reliabilityHtml, reliabilityTitle, factStatusHtml, personMarksLayout, cardReliabilityMarkHtml, reliabilityLabel,
} from '../ui/fact-status.js';
import { personOriginSummary, ReliabilityOptions } from '../reliability.js';
import type { ImportRecord, Person, StromData } from '../types.js';

const PLAIN: ReliabilityOptions = { researchTree: false, originFeature: false };
const I1: ImportRecord = { id: 'I1', program: 'Rodokmenar', fileDate: '12 MAR 2024', at: '2026-10-01' };
const DATA: Pick<StromData, 'imports'> = { imports: [I1] };

const person = (extra: Partial<Person> = {}): Person => ({
    id: 'p1', firstName: 'Hostivít', lastName: 'Šmudlák', gender: 'male',
    parentIds: [], childIds: [], partnerships: [], ...extra,
}) as unknown as Person;

const fromFile = (extra: Partial<Person> = {}): Person => person({
    birthDate: '1851-02-02',
    importedValues: {
        firstName: { from: 'I1', value: 'Hostivít' }, lastName: { from: 'I1', value: 'Šmudlák' },
        gender: { from: 'I1', value: 'male' }, birthDate: { from: 'I1', value: '1851-02-02' },
    },
    ...extra,
});

/** The opening tag's name and attributes, the glyphs and the text of a mark (no DOM in the unit tests). */
const parse = (html: string) => {
    const open = /^<(\w+)([^>]*)>/.exec(html);
    const attrs: Record<string, string> = {};
    for (const m of (open?.[2] ?? '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[m[1]] = m[2] ?? '';
    return {
        tag: open?.[1] ?? '',
        attrs,
        classes: (attrs.class ?? '').split(' '),
        dots: (html.match(/<i(?: class="on")?><\/i>/g) ?? []).length,
        dotsOn: (html.match(/<i class="on"><\/i>/g) ?? []).length,
        check: html.includes('class="fs-check"'),
        text: /<span class="fs-text">([^<]*)<\/span>/.exec(html)?.[1] ?? '',
    };
};

describe('reliabilityHtml', () => {
    it('a person\'s confirmation: a check, a button with the step', () => {
        const el = parse(reliabilityHtml({ step: 'human' }, 'Confirmed by a person'));
        expect(el.tag).toBe('button');
        expect(el.attrs.type).toBe('button');
        expect(el.classes).toContain('fact-status-human');
        expect(el.attrs['aria-expanded']).toBe('false');
        expect(el.check).toBe(true);
        expect(el.text).toBe('Confirmed');
    });

    it('proven: one or two full dots', () => {
        const one = parse(reliabilityHtml({ step: 'proven', dots: 1 }, 't'));
        const two = parse(reliabilityHtml({ step: 'proven', dots: 2 }, 't'));
        expect(one.dots).toBe(2);
        expect(one.dotsOn).toBe(1);
        expect(two.dotsOn).toBe(2);
        expect(two.attrs['data-dots']).toBe('2');
    });

    it('from the family tree: two empty dots; a lead or no source: text only', () => {
        const imp = parse(reliabilityHtml({ step: 'import' }, 't'));
        expect(imp.dots).toBe(2);
        expect(imp.dotsOn).toBe(0);
        const lead = parse(reliabilityHtml({ step: 'lead' }, 't'));
        expect(lead.dots + (lead.check ? 1 : 0)).toBe(0);
        expect(parse(reliabilityHtml({ step: 'none' }, 't')).classes).toContain('fact-status-none');
    });

    it('inert inside another button: a span with the title, no tooltip state', () => {
        const el = parse(reliabilityHtml({ step: 'import' }, 'From the file', { inert: true, fact: 'event:e1' }));
        expect(el.tag).toBe('span');
        expect(el.attrs.title).toBe('From the file');
        expect('aria-expanded' in el.attrs).toBe(false);
        expect(el.attrs['data-fact']).toBe('event:e1');
    });

    it('no step: nothing', () => {
        expect(reliabilityHtml(null, 't')).toBe('');
        expect(factStatusHtml(undefined)).toBe('');
    });

    it('the research\'s status alone keeps its label', () => {
        const el = parse(factStatusHtml('probable'));
        expect(el.classes).toContain('fact-status-probable');
        expect(el.text).toBe('Probable');
        expect(el.attrs.title).toMatch(/as the research holds this fact/);
    });
});

describe('reliabilityTitle', () => {
    it('from the family tree: the program and the file\'s date', () => {
        const t = reliabilityTitle({ step: 'import', importRecord: I1, fromParts: ['DATE'], changedParts: [] });
        expect(t).toContain('Rodokmenar');
        expect(t).toMatch(/^From the family tree \(unverified\)/);
    });

    it('partly changed: which part is from the file, and no source yet outside the research', () => {
        const r = { step: 'import' as const, importRecord: I1, fromParts: ['PLAC' as const], changedParts: ['DATE' as const] };
        expect(reliabilityTitle(r)).toBe('The place is from the family tree; the date was changed by a person. There is no source for this fact yet.');
        expect(reliabilityTitle(r, { research: true })).toBe('The place is from the family tree; the date was changed by a person.');
    });

    it('a stronger step with a value from the file says where it came from', () => {
        const t = reliabilityTitle({ step: 'proven', dots: 2, fromImport: true, importRecord: I1 });
        expect(t).toMatch(/^Proven by AI: two readers of the record agree · taken from the family tree Rodokmenar/);
    });

    it('the short labels', () => {
        expect(reliabilityLabel('import')).toBe('From family tree');
        expect(reliabilityLabel('none')).toBe('No source');
    });
});

describe('personMarksLayout', () => {
    it('every fact from the family tree: one pill in the origin row, none at the facts', () => {
        const layout = personMarksLayout(personOriginSummary(DATA, fromFile(), PLAIN));
        expect(layout.atFacts).toBe(false);
        expect(layout.row?.step?.step).toBe('import');
        expect(layout.row?.text).toMatch(/^All of this person's facts come from Rodokmenar/);
    });

    it('a fact changed since: the row explains, the pills stand at the facts', () => {
        const layout = personMarksLayout(personOriginSummary(DATA, fromFile({ birthDate: '1851-02-03' }), PLAIN));
        expect(layout.atFacts).toBe(true);
        expect(layout.row?.step).toBeUndefined();
        expect(layout.row?.text).toMatch(/^Facts marked “from family tree” come from Rodokmenar/);
    });

    it('a fact partly changed since: the same step, yet its pill stands at it', () => {
        const p = fromFile({ birthDate: '1851-02-03', birthPlace: 'Bramborov', importedValues: {
            firstName: { from: 'I1', value: 'Hostivít' }, lastName: { from: 'I1', value: 'Šmudlák' },
            gender: { from: 'I1', value: 'male' },
            birthDate: { from: 'I1', value: '1851-02-02' }, birthPlace: { from: 'I1', value: 'Bramborov' },
        } });
        const summary = personOriginSummary(DATA, p, PLAIN);
        expect(summary.allSameStep?.step).toBe('import');
        expect(personMarksLayout(summary).atFacts).toBe(true);
    });

    it('no import: no row', () => {
        expect(personMarksLayout(personOriginSummary({ imports: [] }, person({ birthDate: '1851' }), PLAIN)))
            .toEqual({ row: null, atFacts: true });
    });
});

describe('cardReliabilityMarkHtml', () => {
    it('the weakest of the name, the birth and the death, with which facts', () => {
        const p = fromFile({ birthDate: '1851-02-03', birthStatus: 'lead' } as Partial<Person>);
        const el = parse(cardReliabilityMarkHtml(DATA, p, PLAIN));
        expect(el.classes).toContain('card-rel-mark');
        expect(el.attrs['data-fact-status']).toBe('lead');
        expect(el.attrs.title).toMatch(/· Weakest fact on the card: birth$/);
        expect(el.text).toBe('');
    });

    it('all from the family tree: two empty dots, name and birth named', () => {
        const el = parse(cardReliabilityMarkHtml(DATA, fromFile(), PLAIN));
        expect(el.attrs['data-fact-status']).toBe('import');
        expect(el.dots).toBe(2);
        expect(el.attrs.title).toMatch(/Weakest fact on the card: name, birth$/);
    });

    it('a tree without marks: nothing', () => {
        expect(cardReliabilityMarkHtml({ imports: [] }, person({ birthDate: '1851' }), PLAIN)).toBe('');
    });
});
