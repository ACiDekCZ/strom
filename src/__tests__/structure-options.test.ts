/**
 * Change structure… (spec 139 §2.4): which options the dialog offers for a
 * tree and why a greyed one is greyed.
 */
import { describe, it, expect } from 'vitest';
import { structureOptions, isWhollyConnected, type StructureContext } from '../structure-options.js';
import type { StromData } from '../types.js';

const base: StructureContext = {
    isActive: true, readOnly: false, liveFollowing: false, otherTrees: true, connected: false,
};

function byKey(ctx: Partial<StructureContext>) {
    return Object.fromEntries(structureOptions({ ...base, ...ctx }).map(o => [o.key, o]));
}

describe('structureOptions', () => {
    it('lists all six options in the dialog order, grouped, with their direction', () => {
        const options = structureOptions(base);
        expect(options.map(o => `${o.group}/${o.key}/${o.dir}`)).toEqual([
            'newTree/select/new', 'newTree/copy/new',
            'split/families/split', 'split/parts/split',
            'join/into/into', 'join/file/file',
        ]);
        expect(options.every(o => o.enabled && !o.reason)).toBe(true);
    });

    it('a tree that is not open: the selection and the file need it open, the rest runs', () => {
        const o = byKey({ isActive: false });
        expect(o.select).toMatchObject({ enabled: false, reason: 'notOpen' });
        expect(o.file).toMatchObject({ enabled: false, reason: 'notOpen' });
        expect(o.copy.enabled).toBe(true);
        expect(o.families.enabled).toBe(true);
        expect(o.parts.enabled).toBe(true);
        expect(o.into.enabled).toBe(true);
    });

    it('a wholly connected tree has no separate parts', () => {
        const o = byKey({ connected: true });
        expect(o.parts).toMatchObject({ enabled: false, reason: 'connected' });
        expect(o.families.enabled).toBe(true);
    });

    it('while the parts are not counted yet, separating stays offered', () => {
        expect(byKey({ connected: null }).parts.enabled).toBe(true);
    });

    it('the only tree has nothing to join into', () => {
        const o = byKey({ otherTrees: false });
        expect(o.into).toMatchObject({ enabled: false, reason: 'noOther' });
        expect(o.file.enabled).toBe(true);
    });

    it('a followed tree cannot take a file; the reason offers to end following', () => {
        const o = byKey({ liveFollowing: true });
        expect(o.file).toMatchObject({ enabled: false, reason: 'followed', reasonAction: 'stopFollowing' });
        expect(o.select.enabled).toBe(true);
        expect(o.into.enabled).toBe(true);
    });

    it('a read-only tree has no dialog', () => {
        expect(structureOptions({ ...base, readOnly: true })).toEqual([]);
    });
});

describe('isWhollyConnected', () => {
    const person = (id: string, extra: Record<string, unknown> = {}) => ({
        id, firstName: id, lastName: 'Kalinovský', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...extra,
    });

    it('two unrelated people are two parts', () => {
        const data = { persons: { a: person('a'), b: person('b') }, partnerships: {} } as unknown as StromData;
        expect(isWhollyConnected(data)).toBe(false);
    });

    it('a parent and a child are one family', () => {
        const data = {
            persons: { a: person('a', { childIds: ['b'] }), b: person('b', { parentIds: ['a'] }) },
            partnerships: {},
        } as unknown as StromData;
        expect(isWhollyConnected(data)).toBe(true);
    });

    it('an empty tree has nothing to separate', () => {
        expect(isWhollyConnected({ persons: {}, partnerships: {} } as unknown as StromData)).toBe(true);
    });
});
