/**
 * What a place record's other names are (research 1.25, `names[i].kind`):
 * `form` a spelling of the facts ("other spelling", never "formerly"),
 * `alt` another name (an old name with the years that end it, else another
 * name with its language). Without `kind` (an older research) every other
 * name stays an old name, as before. Read from the bridge and from the
 * research's GEDCOM (`2 TYPE form|alt` under `1 NAME`). Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import type { PersonId, PlaceRecord, StromData } from '../types.js';
import { placeVariantGroups, recordNameTag } from '../place-groups.js';
import { placeKey, type PlaceUsage } from '../places.js';
import { sanitizePlaceRecord } from '../place-records.js';
import { sanitizeBridgePlaces } from '../places-bridge.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { placeIdentity } from '../place-identity.js';
import { languageName, placeFormerLine, placeWhyRows } from '../places-dialog.js';

const k = placeKey;

function usage(display: string, count: number): PlaceUsage {
    return { display, variants: new Map([[display, count]]), count, personIds: [display] as PersonId[], kinds: new Map(), houses: new Map() };
}

function tree(rec: PlaceRecord, forms: string[]): StromData {
    return {
        persons: {}, partnerships: {}, placeRecords: { [rec.id]: rec },
        placeRefs: Object.fromEntries(forms.map(f => [k(f), rec.id])),
    } as unknown as StromData;
}

const FORMS = ['Dolní Lhota', 'Lhota Dolní', 'Unter-Lhota', 'Lhotau'];
const usages = () => new Map(FORMS.map((f, i) => [k(f), usage(f, 10 - i)]));

describe('recordNameTag', () => {
    it('form → other spelling, alt with an end → old name, alt still in use → other name, none → old name', () => {
        expect(recordNameTag({ name: 'Lhota Dolní', kind: 'form' })).toBe('var');
        expect(recordNameTag({ name: 'Unter-Lhota', kind: 'alt', lang: 'de', to: 1945 })).toBe('old');
        expect(recordNameTag({ name: 'Lhotau', kind: 'alt', lang: 'de' })).toBe('alt');
        expect(recordNameTag({ name: 'Lhotau', kind: 'alt', from: 1850 })).toBe('alt');
        expect(recordNameTag({ name: 'Unter-Lhota', lang: 'de', to: 1945 })).toBe('old');
        expect(recordNameTag({ name: 'Lhota Dolní' })).toBe('old');
    });
});

describe('placeVariantGroups by the names’ kinds', () => {
    it('tags a spelling “other spelling”, an old name with its years and language, another name with its language', () => {
        const rec: PlaceRecord = {
            id: 'L0040',
            names: [
                { name: 'Dolní Lhota' },
                { name: 'Lhota Dolní', kind: 'form' },
                { name: 'Unter-Lhota', lang: 'de', from: 1850, to: 1945, kind: 'alt' },
                { name: 'Lhotau', lang: 'de', kind: 'alt' },
            ],
        };
        const [g] = placeVariantGroups(usages(), { data: tree(rec, FORMS) });
        expect(g!.members).toEqual([
            { key: k('Lhota Dolní'), tag: 'var', same: true },
            { key: k('Unter-Lhota'), tag: 'old', period: '1850–1945', lang: 'de', same: true },
            { key: k('Lhotau'), tag: 'alt', lang: 'de', same: true },
        ]);
        expect(g!.spellings).toBe(4);
    });

    it('an older research without kind: every other name an old name, as before', () => {
        const rec: PlaceRecord = { id: 'L0040', names: [{ name: 'Dolní Lhota' }, { name: 'Lhota Dolní' }, { name: 'Unter-Lhota', to: 1945 }] };
        const [g] = placeVariantGroups(usages(), { data: tree(rec, FORMS) });
        expect(g!.members.filter(m => m.key !== k('Lhotau'))).toEqual([
            { key: k('Lhota Dolní'), tag: 'old', same: true },
            { key: k('Unter-Lhota'), tag: 'old', period: '–1945', same: true },
        ]);
    });

    it('a spelling and another name written alike: the other name', () => {
        const rec: PlaceRecord = {
            id: 'L0040',
            names: [{ name: 'Dolní Lhota' }, { name: 'Lhotau', kind: 'form' }, { name: 'Lhotau', lang: 'de', to: 1918, kind: 'alt' }],
        };
        const [g] = placeVariantGroups(usages(), { data: tree(rec, FORMS) });
        expect(g!.members.find(m => m.key === k('Lhotau'))).toEqual({ key: k('Lhotau'), tag: 'old', period: '–1918', lang: 'de', same: true });
    });

    it('reads the kinds from the live bridge too', () => {
        const live = sanitizeBridgePlaces({
            rev: 'r1',
            places: {
                L0040: {
                    name: 'Dolní Lhota', state: 'identified', coords: { lat: 49.6, lon: 15.2 }, by: 'research',
                    names: [{ name: 'Lhota Dolní', kind: 'form' }, { name: 'Lhotau', lang: 'de', kind: 'alt' }, { name: 'Unter-Lhota', kind: 'nonsense' }],
                    forms: FORMS,
                },
            },
            forms: Object.fromEntries(FORMS.map(f => [f, { place: 'L0040' }])),
        })!;
        expect(live.places.L0040!.names).toEqual([
            { name: 'Dolní Lhota' }, { name: 'Lhota Dolní', kind: 'form' }, { name: 'Lhotau', lang: 'de', kind: 'alt' }, { name: 'Unter-Lhota' },
        ]);
        const data = { persons: {}, partnerships: {}, placeRefs: Object.fromEntries(FORMS.map(f => [k(f), 'L0040'])) } as unknown as StromData;
        const [g] = placeVariantGroups(usages(), { data, live });
        expect(g!.members.map(m => [m.key, m.tag])).toEqual([
            [k('Lhota Dolní'), 'var'], [k('Unter-Lhota'), 'old'], [k('Lhotau'), 'alt'],
        ]);
    });
});

describe('the kind in the record, the GEDCOM and “formerly”', () => {
    it('keeps form/alt, drops anything else', () => {
        const rec = sanitizePlaceRecord({ id: 'L1', names: [{ name: 'A' }, { name: 'B', kind: 'form' }, { name: 'C', kind: 'alt' }, { name: 'D', kind: 'old' }, { name: 'E', kind: 7 }] })!;
        expect(rec.names.map(n => n.kind)).toEqual([undefined, 'form', 'alt', undefined, undefined]);
    });

    it('reads 2 TYPE form|alt under the record’s names', () => {
        const text = [
            '0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '1 BIRT', '2 PLAC Dolní Lhota', '3 _STROM_PLACE @L0040@',
            '0 @L0040@ _STROM_PLACE',
            '1 NAME Dolní Lhota',
            '1 NAME Lhota Dolní', '2 TYPE form',
            '1 NAME Unter-Lhota', '2 LANG de', '2 DATE TO 1945', '2 TYPE alt',
            '1 NAME Lhotau', '2 TYPE ALT',
            '1 NAME Lhotov', '2 TYPE unknown',
            '0 TRLR',
        ].join('\n');
        const data = convertToStrom(parseGedcom(text)).data;
        expect(data.placeRecords!.L0040!.names).toEqual([
            { name: 'Dolní Lhota' },
            { name: 'Lhota Dolní', kind: 'form' },
            { name: 'Unter-Lhota', lang: 'de', to: 1945, kind: 'alt' },
            { name: 'Lhotau', kind: 'alt' },
            { name: 'Lhotov' },
        ]);
    });

    it('“formerly” names the other names, never a spelling of the facts', () => {
        const rec: PlaceRecord = {
            id: 'L0040', coords: { lat: 49.6, lon: 15.2 }, by: 'research',
            names: [{ name: 'Dolní Lhota' }, { name: 'Lhota Dolní', kind: 'form' }, { name: 'Unter-Lhota', lang: 'de', to: 1945, kind: 'alt' }],
        };
        const data = tree(rec, FORMS);
        const id = placeIdentity(k('Lhota Dolní'), { data });
        expect(id.former).toEqual([{ name: 'Unter-Lhota', lang: 'de', to: 1945, kind: 'alt' }]);
        expect(placeFormerLine(id, 'Lhota Dolní', 'cs')).toBe('dříve Unter-Lhota (do 1945)');
        expect(placeWhyRows(id, undefined, 'en').find(r => r.kind === 'before')?.text).not.toContain('Lhota Dolní');
        // Only spellings: no "formerly" at all.
        const onlyForms = tree({ ...rec, names: [{ name: 'Dolní Lhota' }, { name: 'Lhota Dolní', kind: 'form' }] }, FORMS);
        const id2 = placeIdentity(k('Lhota Dolní'), { data: onlyForms });
        expect(id2.former).toBeUndefined();
        expect(placeFormerLine(id2, 'Lhota Dolní', 'cs')).toBe('');
        // An older research: as before.
        const old = tree({ ...rec, names: [{ name: 'Dolní Lhota' }, { name: 'Lhota Dolní' }] }, FORMS);
        expect(placeIdentity(k('Lhota Dolní'), { data: old }).former).toEqual([{ name: 'Lhota Dolní' }]);
    });

    it('another name still in use is no former name: “Vienna”, never “formerly Wien” (detail: Other name, Other spelling)', () => {
        const rec: PlaceRecord = {
            id: 'L0050', coords: { lat: 48.2, lon: 16.4 }, by: 'research',
            names: [{ name: 'Vídeň' }, { name: 'Wien', lang: 'de', kind: 'alt' }, { name: 'Viden', kind: 'form' }, { name: 'Vindobona', kind: 'alt', to: 500 }],
        };
        const data = tree(rec, ['Vídeň', 'Wien', 'Viden', 'Vindobona']);
        const id = placeIdentity(k('Wien'), { data });
        expect(id.former).toEqual([{ name: 'Vindobona', kind: 'alt', to: 500 }]);
        expect(id.others).toEqual([{ name: 'Wien', lang: 'de', kind: 'alt' }]);
        expect(id.spellings).toEqual([{ name: 'Viden', kind: 'form' }]);
        // The tree writes the other name: no "formerly" line at all.
        expect(placeFormerLine(id, 'Wien', 'cs')).toBe('');
        // The tree writes the old name: "formerly" that one.
        expect(placeFormerLine(id, 'Vindobona', 'cs')).toBe('dříve Vindobona (do 500)');
        const rows = placeWhyRows(id, undefined, 'cs');
        expect(rows.filter(r => ['before', 'alt', 'form'].includes(r.kind)).map(r => [r.kind, r.label, r.text])).toEqual([
            ['before', 'Dřív', 'Vindobona (do 500)'],
            ['alt', 'Jiné jméno', 'Wien'],
            ['form', 'Jiný zápis', 'Viden'],
        ]);
        // Only a name still in use: nothing under "Earlier".
        const onlyAlt = tree({ ...rec, names: [{ name: 'Vídeň' }, { name: 'Wien', lang: 'de', kind: 'alt' }] }, ['Vídeň', 'Wien']);
        const id2 = placeIdentity(k('Wien'), { data: onlyAlt });
        expect(id2.former).toBeUndefined();
        expect(placeWhyRows(id2, undefined, 'en').find(r => r.kind === 'before')).toBeUndefined();
        expect(placeWhyRows(id2, undefined, 'pl').find(r => r.kind === 'alt')?.label).toBe('Inna nazwa');
    });

    it('names a name’s language in the UI language', () => {
        expect(languageName('de', 'cs')).toBe('němčina');
        expect(languageName('de', 'en')).toBe('German');
        expect(languageName('de', 'pl')).toBe('niemiecki');
        expect(languageName(undefined, 'cs')).toBe('');
    });
});
