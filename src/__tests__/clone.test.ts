/**
 * cloneTreeData / cloneTreeDataAsJson: independent copies of tree data that
 * share strings (undo snapshots and saves of trees with many images).
 */

import { describe, it, expect } from 'vitest';
import { cloneTreeData, cloneTreeDataAsJson, estimateJsonBytes } from '../clone.js';

const sample = () => ({
    persons: { a: { id: 'a', firstName: 'Jan', photo: 'data:image/jpeg;base64,AAAA', note: undefined as string | undefined,
        events: [{ id: 'e', sourceIds: ['s1'] }] } },
    sources: { s1: { id: 's1', excerpts: [{ id: 'x', dataUrl: 'data:image/jpeg;base64,BBBB', region: { x: 0, y: 0, w: 1, h: 0.2 } }] } },
    list: [1, undefined, 'x'],
});

describe('cloneTreeData', () => {
    it('copies the structure deeply', () => {
        const src = sample();
        const copy = cloneTreeData(src);
        expect(copy).toEqual(src);
        copy.persons.a.events[0].sourceIds.push('s2');
        copy.sources.s1.excerpts[0].region.w = 0.5;
        expect(src.persons.a.events[0].sourceIds).toEqual(['s1']);
        expect(src.sources.s1.excerpts[0].region.w).toBe(1);
    });

    it('keeps undefined keys like structuredClone', () => {
        expect('note' in cloneTreeData(sample()).persons.a).toBe(true);
    });
});

describe('cloneTreeDataAsJson', () => {
    it('equals a JSON round-trip', () => {
        const src = sample();
        expect(cloneTreeDataAsJson(src)).toEqual(JSON.parse(JSON.stringify(src)));
        expect('note' in cloneTreeDataAsJson(src).persons.a).toBe(false);
        expect(cloneTreeDataAsJson(src).list).toEqual([1, null, 'x']);
    });
});

describe('estimateJsonBytes', () => {
    it('matches the UTF-8 size of JSON.stringify for plain tree data', () => {
        const data = { ...sample(), name: 'Víšek – Žofie 😀', n: 12.5, ok: true, nil: null };
        const exact = new TextEncoder().encode(JSON.stringify(data)).length;
        expect(estimateJsonBytes(data)).toBe(exact);
    });
});
