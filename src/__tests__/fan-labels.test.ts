/**
 * Fan chart labels (spec 029 §4): the box a sector offers, the reading
 * direction, the label ladder, sizes and dates.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    fanLabelBox, fanRadialRotation, fitFanLabel, fanScreenSizes, fanPrintSizes, fanBaseSize, fanFullDate, fanFullDates, fanYears,
    estimateFanMeasure as measure, defaultFanMeasure, clearFanMeasureCache, FanLabelBox,
} from '../fan-labels.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId } from '../types.js';

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
        expect(texts(fit(p, box(38, 14)))).toEqual(['Laroul…']);
        expect(fit(p, box(38, 14))!.level).toBe(6);
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

    it('cuts a long surname short rather than leaving the sector empty (1101)', () => {
        // §4.4 kept 60 % of a cut surname: a double surname in a small sector then showed nothing.
        const p2 = person({ firstName: 'Anna', lastName: 'Oberwaldenburger-Kreuzfeldt' });
        const l = fit(p2, box(50, 14));
        expect(texts(l)).toEqual(['Oberwald…']);
        expect(l!.level).toBe(6);
        // Never under four letters.
        expect(texts(fit(person(), box(27, 14)))).toEqual(['Laro…']);
    });

    it('where not even four letters fit, the initials (1101)', () => {
        const narrow = (t: string, fs: number) => [...t].reduce((w, c) => w + (c === '.' || c === ' ' ? 0.25 : 0.6), 0) * fs;
        const l = fit(person({ firstName: 'Ursula', lastName: 'Hengstler' }), box(24, 14), { measure: narrow });
        expect(texts(l)).toEqual(['U. H.']);
        expect(l!.level).toBe(7);
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
        const at = (ppu: number) => fit(p, fanLabelBox(s, ppu))?.level ?? 7;
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
