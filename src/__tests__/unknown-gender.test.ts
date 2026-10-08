/**
 * Data format 11 -> 12 (U01): Gender 'unknown' — a sex the records do not
 * give (GEDCOM SEX U, or no SEX), never guessed. Older data keeps its
 * male/female; a missing or invalid gender reads as unknown. A person of
 * unknown sex is no conflict to a known one: merge and duplicate matching
 * take them as possibly the same, the known sex fills the unknown.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { migrateData } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { detectConflicts, quickMatchScore } from '../merge/matching.js';
import { mergePersonData } from '../merge/executor.js';
import { normalizeSingleParents } from '../single-parent.js';
import {
    StromData, Person, PersonId, STROM_DATA_VERSION, oppositeGender, coupleSides, parentSlots, gendersCompatible, isGender,
} from '../types.js';

function person(id: string, gender: unknown, extra: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Zkoušek', gender: gender as Person['gender'], isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

describe('data format 11 -> 12 (Gender unknown)', () => {
    it('is version 12', () => {
        expect(STROM_DATA_VERSION).toBe(12);
    });

    it('a v11 tree keeps every male and female; no gender or an invalid one reads as unknown', () => {
        const v11 = {
            version: 11,
            persons: {
                m: person('m', 'male'), f: person('f', 'female'), u: person('u', 'unknown'),
                none: person('none', undefined), bad: person('bad', 'X'), upper: person('upper', 'Male'),
            },
            partnerships: {},
        } as unknown as StromData;
        delete (v11.persons['none' as PersonId] as Partial<Person>).gender;
        const out = migrateData(v11);
        expect(Object.fromEntries(Object.entries(out.persons).map(([id, p]) => [id, p.gender]))).toEqual({
            m: 'male', f: 'female', u: 'unknown', none: 'unknown', bad: 'unknown', upper: 'unknown',
        });
    });

    it('a JSON import with a person of unknown sex is valid', () => {
        const json = JSON.stringify({ version: 12, persons: { u: person('u', 'unknown') }, partnerships: {} });
        expect(validateJsonImport(json).errors).toEqual([]);
        const bad = JSON.stringify({ version: 12, persons: { u: person('u', 'X') }, partnerships: {} });
        expect(validateJsonImport(bad).errors).toContain('invalidGender:u');
    });
});

describe('helpers', () => {
    it('isGender, oppositeGender, gendersCompatible', () => {
        expect(isGender('unknown')).toBe(true);
        expect(isGender('U')).toBe(false);
        expect(oppositeGender('male')).toBe('female');
        expect(oppositeGender('female')).toBe('male');
        expect(oppositeGender('unknown')).toBe('unknown');
        expect(gendersCompatible('male', 'unknown')).toBe(true);
        expect(gendersCompatible('unknown', 'female')).toBe(true);
        expect(gendersCompatible('male', 'female')).toBe(false);
    });

    it('coupleSides: a man left, a woman right, unknown on the free side, two alike in the given order', () => {
        const side = (a: string, b: string) => coupleSides({ id: 'a', gender: a as Person['gender'] }, { id: 'b', gender: b as Person['gender'] }).map(p => p.id).join('');
        expect(side('male', 'unknown')).toBe('ab');
        expect(side('unknown', 'male')).toBe('ba');
        expect(side('female', 'unknown')).toBe('ba');
        expect(side('unknown', 'female')).toBe('ab');
        expect(side('unknown', 'unknown')).toBe('ab');
        expect(side('female', 'male')).toBe('ba');
        expect(side('female', 'female')).toBe('ab');
    });

    it('parentSlots: an only parent of unknown sex in the father\'s slot, a mother in hers', () => {
        const u = { gender: 'unknown' as const }, f = { gender: 'female' as const };
        expect(parentSlots([u])).toEqual([u, null]);
        expect(parentSlots([f])).toEqual([null, f]);
        expect(parentSlots([f, u])).toEqual([u, f]);
    });
});

describe('the "?" stand-in of one known parent', () => {
    it('is of the opposite sex — unknown for a parent of unknown sex', () => {
        const data = {
            persons: {
                p: person('p', 'unknown', { childIds: ['c' as PersonId] }),
                c: person('c', 'male', { parentIds: ['p' as PersonId] }),
            },
            partnerships: {},
        } as unknown as StromData;
        normalizeSingleParents(data);
        const standIn = Object.values(data.persons).find(p => p.isPlaceholder)!;
        expect(standIn.gender).toBe('unknown');
    });
});

describe('merge with an unknown sex (U01)', () => {
    it('unknown and known: no gender conflict, the known sex fills the unknown', () => {
        const existing = person('a', 'unknown', { birthDate: '1890' });
        const incoming = person('b', 'female', { birthDate: '1890' });
        expect(detectConflicts(existing, incoming).map(c => c.field)).not.toContain('gender');
        mergePersonData(existing, incoming, detectConflicts(existing, incoming));
        expect(existing.gender).toBe('female');
        // The other way round: the known sex here stays.
        const known = person('k', 'male', { birthDate: '1890' });
        mergePersonData(known, person('x', 'unknown', { birthDate: '1890' }), []);
        expect(known.gender).toBe('male');
    });

    it('male and female are still a conflict (never auto-flipped)', () => {
        const conflicts = detectConflicts(person('a', 'male'), person('b', 'female'));
        expect(conflicts.find(c => c.field === 'gender')?.resolution).toBe('keep_existing');
    });

    it('duplicate matching takes an unknown sex as possibly the same person', () => {
        const a = person('a', 'unknown', { firstName: 'Anna', birthDate: '1890-03-04' });
        const b = person('b', 'female', { firstName: 'Anna', birthDate: '1890-03-04' });
        expect(quickMatchScore(a, b)).toBeGreaterThan(0);
        expect(quickMatchScore(person('c', 'male', { firstName: 'Anna', birthDate: '1890-03-04' }), b)).toBe(0);
    });
});
