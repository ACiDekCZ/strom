/**
 * Fan chart labels (spec 029 §4): the box a sector offers, the reading
 * direction, the label ladder, sizes and dates.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    fanLabelBox, fanRadialRotation, fitFanLabel, fanScreenSizes, fanPrintSizes, fanBaseSize, fanFullDate, fanFullDates, fanYears,
    estimateFanMeasure as measure, defaultFanMeasure, clearFanMeasureCache, FanLabelBox, fanShortPlace, fanPlaceRows, FAN_CONTENTS,
    fitFanSectorLabel, FanContent,
} from '../fan-labels.js';
import { buildFanModel, FanModel } from '../fan-chart.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, StromData } from '../types.js';

function person(o: Partial<Person> = {}): Person {
    return {
        id: 'p' as PersonId, firstName: 'Bohumil Karel', lastName: 'Laroulek', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], birthDate: '1762-08-24', deathDate: '1821-03-01', ...o,
    };
}
const box = (len: number, cross: number): FanLabelBox => ({ curved: false, anchor: 0, aspan: 0, upper: true, mid: 0, rc: 100, len, cross });
const fit = (p: Person, b: FanLabelBox, o: Partial<Parameters<typeof fitFanLabel>[2]> = {}) =>
    fitFanLabel(p, b, { base: 12, min: 9, measure, ...o });
const texts = (l: ReturnType<typeof fitFanLabel>) => l?.rows.map(r => r.text) ?? null;

afterEach(() => setLanguage('en'));

describe('fanLabelBox (§4.2)', () => {
    it('writes along the arc in wide sectors and along the radius in narrow ones', () => {
        expect(fanLabelBox({ r1: 56, r2: 140, lo: 90, hi: 180 }, 1).curved).toBe(true);
        expect(fanLabelBox({ r1: 360, r2: 422, lo: 168.75, hi: 180 }, 1).curved).toBe(false);
        // Near the horizontal the arc text would lie on its side: radial instead.
        expect(fanLabelBox({ r1: 140, r2: 220, lo: 157.5, hi: 180 }, 3).curved).toBe(false);
    });

    it('a radial label may use the ring but 4 px at each end: a surname that fits stays whole (1101)', () => {
        // The outer ring of the person page's fan beside the horizontal, at its desktop scale.
        const s = { r1: 294, r2: 362, lo: 0, hi: 11.25 };
        const b = fanLabelBox(s, 0.86);
        expect(b.curved).toBe(false);
        expect(b.len).toBeCloseTo(68 * 0.86 - 8);
        const l = fitFanLabel(person({ firstName: 'Ursula', lastName: 'Hengstler' }), b, { base: 12, min: 9, measure });
        expect(l!.rows.map(r => r.text)).toContain('Hengstler');
    });

    it('grows with the scale', () => {
        const s = { r1: 360, r2: 422, lo: 168.75, hi: 180 };
        const a = fanLabelBox(s, 1), b = fanLabelBox(s, 2);
        expect(b.len).toBeGreaterThan(a.len);
        expect(b.cross).toBeGreaterThan(a.cross);
    });

    it('a full-circle parent keeps its text on the upper half (at most 150°)', () => {
        const b = fanLabelBox({ r1: 56, r2: 140, lo: 90, hi: 270 }, 1);
        expect(b.curved).toBe(true);
        expect(b.upper).toBe(true);
        expect(b.aspan).toBeLessThanOrEqual(150);
    });
});

describe('reading direction (§4.3)', () => {
    it('never turns a radial label upside down', () => {
        for (let mid = 0; mid < 360; mid += 7.5) {
            const rot = ((fanRadialRotation(mid) % 360) + 360) % 360;
            // The text's x axis must point rightward or at most straight up/down.
            expect(Math.cos((rot * Math.PI) / 180), `mid ${mid}`).toBeGreaterThanOrEqual(-1e-9);
        }
    });
});

describe('label ladder (§4.4)', () => {
    const p = person();

    it('steps down from full dates to years, initials, the name alone and the surname as the box shrinks', () => {
        expect(texts(fit(p, box(400, 60)))).toEqual(['Bohumil Karel Laroulek', '24 Aug 1762 – 1 Mar 1821']);
        expect(fit(p, box(400, 60))!.level).toBe(1);
        expect(texts(fit(p, box(110, 40)))).toEqual(['Bohumil Karel', 'Laroulek', '1762–1821']);
        expect(fit(p, box(110, 40))!.level).toBe(2);
        expect(texts(fit(p, box(110, 28)))).toEqual(['B. K. Laroulek', '1762–1821']);
        expect(fit(p, box(110, 28))!.level).toBe(3);
        expect(texts(fit(p, box(110, 14)))).toEqual(['B. K. Laroulek']);
        expect(fit(p, box(110, 14))!.level).toBe(4);
        expect(texts(fit(p, box(50, 14)))).toEqual(['Laroulek']);
        expect(fit(p, box(50, 14))!.level).toBe(5);
        // Not even "Bohumil L." fits: the surname is cut.
        expect(texts(fit(p, box(38, 14)))).toEqual(['Laroul…']);
        expect(fit(p, box(38, 14))!.level).toBe(7);
        expect(fit(p, box(15, 14))).toBeNull();
    });

    it('breaks a double surname after its hyphen before shortening it (1101)', () => {
        const p2 = person({ firstName: 'Anna', lastName: 'Oberwaldenburger-Kreuzfeldt', birthDate: '1931-01-14', deathDate: '2019-06-02' });
        const l = fit(p2, box(110, 60));
        expect(texts(l)).toEqual(['Anna', 'Oberwaldenburger-', 'Kreuzfeldt', '1931–2019']);
        expect(l!.level).toBe(2);
        // Two lines only: the initial goes before the first half, then the halves alone.
        expect(texts(fit(p2, box(115, 26)))).toEqual(['A. Oberwaldenburger-', 'Kreuzfeldt']);
        expect(texts(fit(p2, box(100, 26)))).toEqual(['Oberwaldenburger-', 'Kreuzfeldt']);
    });

    it('where the surname would be cut, the given name with its initial and the years where they fit (1101)', () => {
        const p2 = person({ firstName: 'Velmira', lastName: 'Dlouhozmarná-Pšenkovická', birthDate: '1872', deathDate: '1932' });
        // Not even the first half of the double surname fits: "Velmira D." and the years, not "Dlouhozm…".
        const l = fit(p2, box(60, 30));
        expect(texts(l)).toEqual(['Velmira D.', '1872–1932']);
        expect(l!.level).toBe(6);
        // No room for the years: the given name with the initial alone.
        expect(texts(fit(p2, box(60, 14)))).toEqual(['Velmira D.']);
        // Too short for one line, tall enough for two: the initial under the given name.
        expect(texts(fit(p2, box(40, 30)))).toEqual(['Velmira', 'D.']);
        // Several given names: only the first, where all of them do not fit.
        expect(texts(fit({ ...p2, firstName: 'Velmira Bertoldina' }, box(60, 30)))).toEqual(['Velmira D.', '1872–1932']);
        // Not even that fits: the cut surname as before.
        expect(texts(fit(p2, box(40, 14)))).toEqual(['Dlouho…']);
        expect(fit(p2, box(40, 14))!.level).toBe(7);
    });

    it('cuts a long surname short rather than leaving the sector empty (1101)', () => {
        // §4.4 kept 60 % of a cut surname: a double surname in a small sector then showed nothing.
        const p2 = person({ firstName: 'Bertoldina', lastName: 'Oberwaldenburger-Kreuzfeldt' });
        const l = fit(p2, box(50, 14));
        expect(texts(l)).toEqual(['Oberwald…']);
        expect(l!.level).toBe(7);
        // Never under four letters.
        expect(texts(fit(person(), box(27, 14)))).toEqual(['Laro…']);
    });

    it('where not even four letters fit, the initials (1101)', () => {
        const narrow = (t: string, fs: number) => [...t].reduce((w, c) => w + (c === '.' || c === ' ' ? 0.25 : 0.6), 0) * fs;
        const l = fit(person({ firstName: 'Ursula', lastName: 'Hengstler' }), box(24, 14), { measure: narrow });
        expect(texts(l)).toEqual(['U. H.']);
        expect(l!.level).toBe(8);
        // A protected living person never: the initials would name them.
        expect(fit(person({ firstName: 'Ursula', lastName: 'Hengstler', deathDate: undefined }), box(24, 14), { measure: narrow, protect: true })).toBeNull();
        // An unknown person has none.
        expect(fit(person({ firstName: '', lastName: '' }), box(24, 14), { measure: narrow })?.rows.map(r => r.text) ?? []).not.toContain('?.');
    });

    it('breaks a long name into given names over the surname before shortening it', () => {
        expect(texts(fit(person({ firstName: 'Johannes Jacobus', deathDate: undefined, birthDate: undefined }), box(100, 30)))).toEqual(['Johannes Jacobus', 'Laroulek']);
    });

    it('shows more of a label at a larger scale (K1.4)', () => {
        const s = { r1: 360, r2: 422, lo: 168.75, hi: 180 };
        const at = (ppu: number) => fit(p, fanLabelBox(s, ppu))?.level ?? 9;
        expect(at(1)).toBeGreaterThan(at(2));
        expect(at(2)).toBeGreaterThan(at(5));
    });

    it('protects a living person: "Living person", no name, no dates', () => {
        const l = fit(person({ deathDate: undefined }), box(400, 60), { protect: true });
        expect(texts(l)).toEqual(['Living person']);
    });

    it('starts a repeat with ↻', () => {
        expect(texts(fit(p, box(400, 60), { repeat: true }))![0]).toBe('↻ Bohumil Karel Laroulek');
    });

    it('puts the birth surname on its own lighter row, only where it fits', () => {
        const w = person({ gender: 'female', firstName: 'Anna', lastName: 'Ostružníková', marriedSurname: 'Kvítková', deathDate: undefined, birthDate: '1960' });
        const big = fit(w, box(300, 60))!;
        expect(big.rows[0]).toMatchObject({ text: 'Anna Kvítková', bold: true });
        expect(big.rows[1]).toMatchObject({ text: 'née Ostružníková', bold: false });
        expect(fit(w, box(90, 14))!.rows.some(r => r.text.includes('Ostružníková'))).toBe(false);
    });

    it('keeps the years 1.5 px under the name and never under the minimum', () => {
        const l = fit(p, box(400, 60))!;
        expect(l.rows[1].fs).toBe(l.rows[0].fs - 1.5);
        const small = fit(p, box(110, 40))!;
        for (const r of small.rows) expect(r.fs).toBeGreaterThanOrEqual(9);
    });
});

describe('sizes (§4.1)', () => {
    it('uses 12/13/14 px on screen with a 10 px minimum on a phone', () => {
        expect(fanScreenSizes(false)).toMatchObject({ base: 12, near: 13, focus: 14, min: 9 });
        expect(fanScreenSizes(true).min).toBe(10);
        expect(fanBaseSize(fanScreenSizes(false), 'anc', 2)).toBe(13);
        expect(fanBaseSize(fanScreenSizes(false), 'anc', 3)).toBe(12);
    });

    it('prints in points: 7.5 pt names, 6 pt minimum', () => {
        const s = fanPrintSizes(0.26);
        expect(s.base * 0.26 / 0.352778).toBeCloseTo(7.5);
        expect(s.min * 0.26 / 0.352778).toBeCloseTo(6);
    });
});

describe('dates', () => {
    it('writes approximate years as the language does', () => {
        expect(fanFullDate('~1712')).toBe('c. 1712');
        setLanguage('cs');
        expect(fanFullDate('~1712')).toBe('asi 1712');
        setLanguage('de');
        expect(fanFullDate('~1712')).toBe('um 1712');
    });

    it('marks born-only and died-only', () => {
        expect(fanYears(person({ deathDate: undefined, birthDate: '1988' }))).toBe('* 1988');
        expect(fanYears(person({ birthDate: undefined }))).toBe('† 1821');
        expect(fanFullDates(person({ birthDate: undefined, deathDate: undefined }))).toBe('');
    });
});

describe('measure', () => {
    it('falls back to the estimate without a document and clears its cache', () => {
        expect(defaultFanMeasure('Laroulek', 10, true)).toBeCloseTo(measure('Laroulek', 10, true));
        clearFanMeasureCache();
    });
});

describe('content of the sectors (spec 118 §5)', () => {
    const placed = (o: Partial<Person> = {}) => person({
        firstName: 'Ilsa', lastName: 'Quellmayer', gender: 'female', birthDate: '1888-11-22', deathDate: '1960-01-25',
        birthPlace: 'Kessenau, okres Dolní Lhota', deathPlace: 'Tálov', ...o,
    });

    it('writes a place as its first part', () => {
        expect(fanShortPlace('Horní Vrbná, okres X')).toBe('Horní Vrbná');
        expect(fanShortPlace('  Tálov ')).toBe('Tálov');
        expect(fanShortPlace(undefined)).toBe('');
    });

    it('rows of birth and death: a place without a date stays, nothing without places', () => {
        setLanguage('cs');
        expect(fanPlaceRows(placed())).toEqual(['* 22. 11. 1888 Kessenau', '† 25. 1. 1960 Tálov']);
        // Only the place.
        expect(fanPlaceRows(placed({ birthDate: undefined, deathDate: undefined, deathPlace: undefined }))).toEqual(['* Kessenau']);
        // The death's date with the birth's place: both rows, each with what it has.
        expect(fanPlaceRows(placed({ birthDate: undefined, deathPlace: undefined }))).toEqual(['* Kessenau', '† 25. 1. 1960']);
        // Only dates: no places, the years say the rest.
        expect(fanPlaceRows(placed({ birthPlace: undefined, deathPlace: undefined }))).toEqual([]);
        expect(fanPlaceRows(person({ birthDate: undefined, deathDate: undefined }))).toEqual([]);
    });

    it("'places' writes the name with two rows of dates and places where they fit (step 0)", () => {
        setLanguage('cs');
        const l = fit(placed(), box(400, 80), { content: 'places' })!;
        expect(l.level).toBe(0);
        expect(texts(l)).toEqual(['Ilsa Quellmayer', '* 22. 11. 1888 Kessenau', '† 25. 1. 1960 Tálov']);
        // The dates' rows as the years: lighter and smaller than the name.
        expect(l.rows.slice(1).every(r => !r.bold && r.fs < l.rows[0].fs)).toBe(true);
    });

    it("'places' in a small box is the same label as 'years'", () => {
        for (const [len, cross] of [[110, 40], [110, 28], [60, 14], [38, 14], [140, 30]]) {
            expect(fit(placed(), box(len, cross), { content: 'places' })).toEqual(fit(placed(), box(len, cross)));
        }
    });

    it("'places' without any place is the same label as 'years'", () => {
        const p = placed({ birthPlace: undefined, deathPlace: undefined });
        expect(fit(p, box(400, 80), { content: 'places' })).toEqual(fit(p, box(400, 80)));
    });

    it("'names' never writes a row of dates or years", () => {
        for (const [len, cross] of [[400, 80], [400, 60], [110, 40], [110, 28], [60, 30], [60, 14], [38, 14]]) {
            const l = fit(placed(), box(len, cross), { content: 'names' });
            expect(l, `${len}×${cross}`).not.toBeNull();
            expect(l!.rows.every(r => r.bold), `${len}×${cross}`).toBe(true);
            expect(l!.rows.some(r => /\d/.test(r.text)), `${len}×${cross}`).toBe(false);
        }
    });

    it('a protected living person stays "Living person" whatever the content', () => {
        const p = placed({ deathDate: undefined, deathPlace: undefined });
        const years = fit(p, box(400, 80), { protect: true });
        for (const content of FAN_CONTENTS) expect(fit(p, box(400, 80), { protect: true, content })).toEqual(years);
        expect(texts(years)).toEqual(['Living person']);
    });
});

// A safety net for a loaded machine (the full suite with other runs beside it): the 10 rings take
// under a second alone, past the default 5 s when the machine is busy; the tests check no time.
describe('no text overflows its sector (spec 118 §5, large fans)', { timeout: 60_000 }, () => {
    /** A complete pedigree of `gens` rings, everybody with dates and places. */
    function pedigree(gens: number): StromData {
        const persons: Record<string, Person> = {};
        const names = ['Laroulek', 'Quellmayer', 'Oberwaldenburger-Kreuzfeldt', 'Ostružník', 'Kvítek'];
        for (let n = 1; n < 2 ** (gens + 1); n++) {
            const g = Math.floor(Math.log2(n));
            const born = 2000 - 27 * g;
            persons[`a${n}`] = person({
                id: `a${n}` as PersonId, gender: n === 1 || n % 2 === 0 ? 'male' : 'female',
                firstName: n % 2 === 0 ? 'Bohumil Karel' : 'Anna', lastName: names[n % names.length],
                parentIds: n < 2 ** gens ? [`a${2 * n}`, `a${2 * n + 1}`] as PersonId[] : [],
                birthDate: `${born}-11-22`, deathDate: `${born + 60}-01-25`,
                birthPlace: n % 3 ? 'Horní Vrbná, okres X' : 'Kessenau', deathPlace: n % 4 ? 'Tálov' : undefined,
            });
        }
        return { persons, partnerships: {} } as unknown as StromData;
    }
    const LINE = 1.18;

    function check(model: FanModel, ppu: number, content: FanContent): { places: number; labels: number } {
        const sizes = fanScreenSizes(false);
        let places = 0, labels = 0;
        for (const s of model.sectors) {
            if (!s.person) continue;
            const r = fitFanSectorLabel(s.person, s, ppu, {
                base: fanBaseSize(sizes, 'anc', s.generation) + (content === 'names' ? 1 : 0), min: sizes.min,
                yearsDrop: sizes.yearsDrop, content, measure,
            });
            if (!r) continue;
            labels++;
            if (r.label.level === 0) places++;
            const w = Math.max(...r.label.rows.map(row => measure(row.text, row.fs, row.bold)));
            const h = r.label.rows.reduce((a, row) => a + row.fs * LINE, 0);
            const at = `${content} a${s.ahnentafel} @${ppu}`;
            expect(w, at).toBeLessThanOrEqual(r.box.len + 1e-6);
            // A single cut row (steps 7, 8) may use the full line height of the minimum.
            expect(h, at).toBeLessThanOrEqual(Math.max(r.box.cross, sizes.min * LINE) + 1e-6);
            if (content === 'names') expect(r.label.rows.every(row => row.bold), at).toBe(true);
        }
        return { places, labels };
    }

    for (const gens of [8, 10]) {
        it(`${gens} rings, every content, at the whole fan and zoomed in`, () => {
            const d = pedigree(gens);
            for (const shape of ['half', 'full'] as const) {
                const model = buildFanModel(d, 'a1' as PersonId, { generations: gens, shape })!;
                for (const ppu of [0.6, 1.5, 4]) {
                    for (const content of FAN_CONTENTS) check(model, ppu, content);
                }
            }
            // The places show where they fit: the inner rings when zoomed in, never the outermost at the whole fan.
            const half = buildFanModel(d, 'a1' as PersonId, { generations: gens, shape: 'half' })!;
            expect(check(half, 4, 'places').places).toBeGreaterThan(0);
            const outer = half.sectors.filter(s => s.generation === gens);
            const sizes = fanScreenSizes(false);
            expect(outer.some(s => fitFanSectorLabel(s.person!, s, 0.6, { base: sizes.base, min: sizes.min, content: 'places', measure })?.label.level === 0)).toBe(false);
        });
    }
});
