/**
 * The pictures and files only the browser keeps (spec 108 K1b.1): the
 * fingerprint the "only in browser" indicator compares with the last file
 * copy on a tree linked to Strom Research, and the archive switch (U8).
 */
import { describe, it, expect } from 'vitest';
import { browserMediaFingerprint, browserMediaSafe, ARCHIVE_HOLDS_APP_MEDIA } from '../browser-media.js';
import type { StromData } from '../types.js';

const img = (fill: string, n = 4000) => `data:image/jpeg;base64,${fill.repeat(n)}`;

function tree(over: { photo?: string; attachments?: unknown[]; couple?: string } = {}): StromData {
    return {
        version: 23,
        persons: {
            P1: { id: 'P1', firstName: 'Jan', lastName: 'Novák', gender: 'male', partnerships: ['U1'], parentIds: [], childIds: [],
                ...(over.photo ? { photo: over.photo } : {}), ...(over.attachments ? { attachments: over.attachments } : {}) },
            P2: { id: 'P2', firstName: 'Marie', lastName: 'Nováková', gender: 'female', partnerships: ['U1'], parentIds: [], childIds: [] },
        },
        partnerships: {
            U1: { id: 'U1', person1Id: 'P1', person2Id: 'P2', childIds: [], ...(over.couple ? { photo: over.couple } : {}) },
        },
    } as unknown as StromData;
}

const att = (id: string, dataUrl: string, note?: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl, sizeBytes: dataUrl.length, ...(note ? { note } : {}) });

describe('browserMediaFingerprint', () => {
    it('is empty for a tree without portraits, couple photos or attachments', () => {
        expect(browserMediaFingerprint(tree())).toBe('');
    });

    it('counts a portrait, a couple photo and an attachment', () => {
        expect(browserMediaFingerprint(tree({ photo: img('A') }))).not.toBe('');
        expect(browserMediaFingerprint(tree({ couple: img('B') }))).not.toBe('');
        expect(browserMediaFingerprint(tree({ attachments: [att('a1', img('C'))] }))).not.toBe('');
    });

    it('changes with a new picture, a re-cropped one (other length) or another attachment', () => {
        const base = browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C'))] }));
        expect(browserMediaFingerprint(tree({ photo: img('D'), attachments: [att('a1', img('C'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A', 3999), attachments: [att('a1', img('C'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C')), att('a2', img('E'))] }))).not.toBe(base);
        expect(browserMediaFingerprint(tree({ photo: img('A') }))).not.toBe(base);
    });

    it('stays the same for the same pictures in a copy, and for an attachment note', () => {
        const base = browserMediaFingerprint(tree({ photo: img('A'), attachments: [att('a1', img('C'))], couple: img('B') }));
        expect(browserMediaFingerprint(structuredClone(tree({ photo: img('A'), attachments: [att('a1', img('C'), 'note')], couple: img('B') })))).toBe(base);
    });

    it('leaves out an attachment that is only its original (kept by the research)', () => {
        const onlyOriginal = { ...att('a1', ''), originalOnly: true, original: { sha256: 'f'.repeat(64), bytes: 9 } };
        expect(browserMediaFingerprint(tree({ attachments: [onlyOriginal] }))).toBe('');
    });
});

describe('browserMediaSafe', () => {
    it('is safe without pictures, or when the last file copy carried exactly these', () => {
        expect(browserMediaSafe('', undefined, false)).toBe(true);
        expect(browserMediaSafe('x', 'x', false)).toBe(true);
    });

    it('is not safe for pictures no file copy holds, or not known yet', () => {
        expect(browserMediaSafe('x', undefined, false)).toBe(false);
        expect(browserMediaSafe('x', 'y', false)).toBe(false);
        expect(browserMediaSafe('x', '', false)).toBe(false);
        expect(browserMediaSafe(undefined, undefined, false)).toBe(false);
    });

    it('is safe whenever the archive keeps the app\'s pictures (spec 108 U8), which it does not yet', () => {
        expect(ARCHIVE_HOLDS_APP_MEDIA).toBe(false);
        expect(browserMediaSafe('x', undefined, true)).toBe(true);
        expect(browserMediaSafe('x', undefined)).toBe(false);
    });
});
